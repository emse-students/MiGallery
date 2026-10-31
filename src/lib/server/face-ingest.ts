/**
 * Ingestion (lot A3, docs/wiki/face-matching-option-c.md): every asset of Immich is detected and
 * embedded ONCE, its faces sealed into `faces.db`, then decided by the match engine (A4).
 *
 * DURABLE STATE, NOT A CLOCK. `face_assets` says, per asset, `pending`, `done` or `failed`. A pass
 * takes the pending rows; a restart loses nothing but the pass in flight. The listing that finds
 * new assets is only discovery: the daily full reconciliation is what proves nothing is missed,
 * and it is also what notices an asset deleted from Immich and removes its faces.
 *
 * WHAT STOPS A PASS AND WHAT COUNTS AGAINST AN ASSET. The model service or Immich unreachable is a
 * fact about the service, not the asset: the pass stops, no attempt is counted, the report names
 * the cause. An answer the client cannot trust is a fact about the asset: one attempt, and after
 * INGEST_MAX_ATTEMPTS the asset is `failed`, reported every hour until someone looks.
 *
 * NOT BEFORE THE SEED. Until `face_store_state.seeded_at` exists, nothing is ingested: the seed
 * (A7) imports the faces Immich already computed, and ingesting first would re-embed the whole
 * archive (about 1.5 days of the model service) for nothing.
 */

import type { DatabaseInstance } from '#lib/db/database.ts';
import { getFaceStoreState } from '#lib/db/face-database.ts';
import { inTransaction } from '#lib/db/transaction.ts';
import { env } from '#lib/server/env.ts';
import { FACE_MODEL, encodeEmbedding, normalizeEmbedding } from '#lib/face-embedding.ts';
import { embeddingContext, seal } from '#lib/server/face-seal.ts';
import { detectFaces, FaceMlResponseError, FaceMlUnavailableError } from '#lib/server/face-ml.ts';
import {
  defaultFaceEngine,
  matchNewFaces,
  removeAssetFaces,
  runExclusive,
  type FaceEngine,
  type OpenedFace,
} from '#lib/server/face-engine.ts';
import { OUTBOUND_BUDGET_MS } from '#lib/server/outbound.ts';
import { registerShutdown } from '#lib/server/shutdown.ts';
import { createLogger } from '#lib/server/logger.ts';

const log = createLogger('face-ingest');

/** Attempts on an answer the client cannot trust before the asset is `failed`. */
export const INGEST_MAX_ATTEMPTS = 5;
/** Assets embedded per pass at most (each is about 0.5 s of the model service). */
export const INGEST_PASS_LIMIT = 500;
/** A pending asset older than this makes the hourly report an error. */
export const INGEST_OVERDUE_MS = 24 * 60 * 60 * 1000;
/** Search page size of a listing. */
const LIST_PAGE = 1000;
/** Pages a full listing may read before it is called incomplete (5 million assets). */
const LIST_MAX_PAGES = 5000;
/**
 * A full listing that names fewer than this share of the assets already known is not believed:
 * nothing is removed on its word. Immich losing half its library in a day is not a case to act on
 * blindly; a bug, a wrong key or a partial answer is far likelier.
 */
const RECONCILE_MIN_SHARE = 0.5;

/** Why a pass stopped before its end. */
export type IngestStop = 'ml_unavailable' | 'immich_unavailable' | 'not_seeded' | null;

/** The service that answered nothing usable: the pass stops, the asset is not blamed. */
class ImmichUnavailableError extends Error {
  readonly kind = 'immich_unavailable';
}

function immich(): { base: string; key: string } {
  const base = env.IMMICH_BASE_URL?.replace(/\/$/, '');
  if (!base) {
    throw new ImmichUnavailableError('IMMICH_BASE_URL not configured');
  }
  return { base, key: env.IMMICH_API_KEY ?? '' };
}

interface ListedAsset {
  id: string;
}

/**
 * Every asset id of one search, page by page. `complete` is false when the page cap stopped it.
 * Throws ImmichUnavailableError on any refusal or transport failure.
 */
async function listAssetIds(
  fetchFn: typeof fetch,
  filter: Record<string, unknown>
): Promise<{ ids: string[]; complete: boolean }> {
  const { base, key } = immich();
  const ids: string[] = [];
  let page: number | null = 1;
  let pages = 0;
  while (page !== null && pages < LIST_MAX_PAGES) {
    let res: Response;
    try {
      res = await fetchFn(`${base}/api/search/metadata`, {
        method: 'POST',
        signal: AbortSignal.timeout(OUTBOUND_BUDGET_MS),
        headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...filter, page, size: LIST_PAGE }),
      });
    } catch (e) {
      throw new ImmichUnavailableError(`asset listing failed: ${(e as Error).message}`);
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw new ImmichUnavailableError(`asset listing answered ${res.status}`);
    }
    const data = (await res.json()) as {
      assets?: { items?: ListedAsset[]; nextPage?: string | number | null };
    };
    const items = data.assets?.items ?? [];
    for (const item of items) {
      ids.push(item.id);
    }
    pages++;
    const raw = data.assets?.nextPage;
    const next = raw === null || raw === undefined ? null : Number(raw);
    page = items.length > 0 && next !== null && Number.isFinite(next) ? next : null;
  }
  return { ids, complete: page === null };
}

/** Add a `pending` row for each id the store does not know yet. Returns how many were added. */
export function addPending(
  faceDb: DatabaseInstance,
  ids: ReadonlyArray<string>,
  now: number
): number {
  const insert = faceDb.prepare(
    `INSERT OR IGNORE INTO face_assets (asset_id, model, state, discovered_at, updated_at)
     VALUES (?, ?, 'pending', ?, ?)`
  );
  let added = 0;
  inTransaction(faceDb, () => {
    for (const id of ids) {
      added += insert.run(id, FACE_MODEL, now, now).changes;
    }
  });
  return added;
}

/** Discovery: assets created in Immich since `since` (ISO), added as pending. */
export async function discoverNew(
  fetchFn: typeof fetch,
  faceDb: DatabaseInstance,
  since: string,
  now: number = Date.now()
): Promise<number> {
  const { ids } = await listAssetIds(fetchFn, { createdAfter: since });
  const added = addPending(faceDb, ids, now);
  log.info('new assets discovered', { listed: ids.length, added });
  return added;
}

/** What a full reconciliation found and did. */
export interface ReconcileResult {
  listed: number;
  added: number;
  removed: number;
  /** Set when removal was refused, with why. */
  refused: string | null;
}

/**
 * The full reconciliation: list EVERY asset Immich has (trashed ones included: a trashed photo can
 * be restored and keeps its faces), add the unknown as pending, and remove the faces of every
 * asset Immich no longer has - only from a complete listing that names at least half of what the
 * store knows.
 */
export async function reconcile(
  fetchFn: typeof fetch,
  engine: FaceEngine,
  now: number = Date.now()
): Promise<ReconcileResult> {
  const { ids, complete } = await listAssetIds(fetchFn, { withDeleted: true });
  const added = addPending(engine.faceDb, ids, now);
  const known = engine.faceDb
    .prepare('SELECT asset_id FROM face_assets WHERE model = ?')
    .all(FACE_MODEL) as Array<{ asset_id: string }>;
  const present = new Set(ids);
  const gone = known.map((r) => r.asset_id).filter((id) => !present.has(id));

  let refused: string | null = null;
  if (!complete) {
    refused = 'the listing hit its page cap';
  } else if (ids.length < known.length * RECONCILE_MIN_SHARE) {
    refused = `the listing names ${ids.length} assets against ${known.length} known`;
  }
  let removed = 0;
  if (refused) {
    if (gone.length > 0) {
      log.error('assets missing from Immich NOT removed: the listing is not believed', {
        gone: gone.length,
        refused,
      });
    }
  } else {
    for (const assetId of gone) {
      await runExclusive(() => {
        removeAssetFaces(engine, assetId);
        engine.faceDb
          .prepare('DELETE FROM face_assets WHERE asset_id = ? AND model = ?')
          .run(assetId, FACE_MODEL);
      });
      removed++;
    }
  }
  log.info('store reconciled with Immich', { listed: ids.length, added, removed, refused });
  return { listed: ids.length, added, removed, refused };
}

/** The image the model sees: Immich's preview, the same file Immich's own detection read. */
async function fetchPreview(fetchFn: typeof fetch, assetId: string): Promise<Blob | 'missing'> {
  const { base, key } = immich();
  let res: Response;
  try {
    res = await fetchFn(
      `${base}/api/assets/${encodeURIComponent(assetId)}/thumbnail?size=preview`,
      { headers: { 'x-api-key': key }, signal: AbortSignal.timeout(OUTBOUND_BUDGET_MS) }
    );
  } catch (e) {
    throw new ImmichUnavailableError(`preview fetch failed: ${(e as Error).message}`);
  }
  // Immich answers 400 for an id it does not know (and 404 from anything in between): the asset
  // has no preview to embed, now. It counts as an attempt (a preview may still be generating); a
  // DELETED asset's row and faces are removed by the reconciliation, never on this status alone.
  if (res.status === 404 || res.status === 400) {
    await res.body?.cancel().catch(() => undefined);
    return 'missing';
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    throw new ImmichUnavailableError(`preview answered ${res.status}`);
  }
  return res.blob();
}

/** Outcome of one asset. */
export type IngestOutcome = 'done' | 'retry' | 'failed';

/** Count one attempt against the asset; `failed` once INGEST_MAX_ATTEMPTS is reached. */
function countAttempt(
  engine: FaceEngine,
  assetId: string,
  error: string,
  now: number
): IngestOutcome {
  const row = engine.faceDb
    .prepare(
      `UPDATE face_assets SET attempts = attempts + 1, last_error = ?, updated_at = ?,
         state = CASE WHEN attempts + 1 >= ? THEN 'failed' ELSE state END
       WHERE asset_id = ? AND model = ? RETURNING state`
    )
    .get(error.slice(0, 300), now, INGEST_MAX_ATTEMPTS, assetId, FACE_MODEL) as {
    state: string;
  } | null;
  log.warn('an asset could not be embedded', { assetId, error, state: row?.state ?? null });
  return row?.state === 'failed' ? 'failed' : 'retry';
}

/**
 * Embed one asset and write its faces, then decide them. Throws FaceMlUnavailableError or
 * ImmichUnavailableError when a service is down (the caller stops the pass).
 */
export async function ingestAsset(
  fetchFn: typeof fetch,
  engine: FaceEngine,
  assetId: string,
  now: number = Date.now()
): Promise<IngestOutcome> {
  const preview = await fetchPreview(fetchFn, assetId);
  if (preview === 'missing') {
    return countAttempt(engine, assetId, 'no_preview: Immich has no preview for it', now);
  }
  let detected;
  try {
    detected = await detectFaces(fetchFn, preview);
  } catch (e) {
    if (e instanceof FaceMlResponseError) {
      return countAttempt(engine, assetId, `bad_response: ${e.message}`, now);
    }
    throw e;
  }

  const faces: OpenedFace[] = detected.faces.map((face, faceIndex) => ({
    assetId,
    faceIndex,
    embedding: normalizeEmbedding(face.embedding),
  }));
  await runExclusive(() => {
    // Faces written again replace the old ones and every decision on them: an index may now name
    // a different face.
    removeAssetFaces(engine, assetId);
    const insert = engine.faceDb.prepare(
      `INSERT INTO face_embeddings (asset_id, face_index, model, x1, y1, x2, y2, img_w, img_h,
         score, sealed, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    inTransaction(engine.faceDb, () => {
      detected.faces.forEach((face, faceIndex) => {
        insert.run(
          assetId,
          faceIndex,
          FACE_MODEL,
          face.box.x1,
          face.box.y1,
          face.box.x2,
          face.box.y2,
          detected.imageWidth,
          detected.imageHeight,
          face.score,
          seal(
            engine.key,
            embeddingContext(assetId, faceIndex, FACE_MODEL),
            encodeEmbedding(face.embedding)
          ),
          now
        );
      });
      engine.faceDb
        .prepare(
          `UPDATE face_assets SET state = 'done', source = 'ml', faces = ?, last_error = NULL,
             attempts = attempts + 1, updated_at = ? WHERE asset_id = ? AND model = ?`
        )
        .run(detected.faces.length, now, assetId, FACE_MODEL);
    });
    matchNewFaces(engine, faces);
  });
  return 'done';
}

/** What a pass did, and why it stopped early if it did. */
export interface PassResult {
  done: number;
  retry: number;
  failed: number;
  stopped: IngestStop;
}

/** Embed up to `limit` pending assets, oldest first. */
export async function runIngestPass(
  fetchFn: typeof fetch,
  engine: FaceEngine,
  limit: number = INGEST_PASS_LIMIT
): Promise<PassResult> {
  const result: PassResult = { done: 0, retry: 0, failed: 0, stopped: null };
  if (!getFaceStoreState(engine.faceDb, 'seeded_at')) {
    result.stopped = 'not_seeded';
    return result;
  }
  const pending = engine.faceDb
    .prepare(
      "SELECT asset_id FROM face_assets WHERE state = 'pending' AND model = ? ORDER BY discovered_at LIMIT ?"
    )
    .all(FACE_MODEL, limit) as Array<{ asset_id: string }>;
  for (const { asset_id } of pending) {
    try {
      result[await ingestAsset(fetchFn, engine, asset_id)]++;
    } catch (e) {
      if (e instanceof FaceMlUnavailableError) {
        result.stopped = 'ml_unavailable';
      } else if (e instanceof ImmichUnavailableError) {
        result.stopped = 'immich_unavailable';
      } else {
        throw e;
      }
      log.warn('ingest pass stopped: a service is down; no asset is blamed', {
        stopped: result.stopped,
        error: (e as Error).message,
      });
      break;
    }
  }
  if (pending.length > 0) {
    log.info('ingest pass', { ...result });
  }
  return result;
}

/** The hourly report's figures. */
export interface IngestReport {
  seeded: boolean;
  pending: number;
  done: number;
  failed: number;
  oldestPendingMs: number | null;
  failedCauses: Record<string, number>;
  lastStop: IngestStop;
}

/**
 * The hourly report. An error when an asset failed, when an asset waits more than a day, or when
 * the store is not seeded; it NAMES the cause (the last stop of a pass, and the failed assets
 * grouped by the kind of their last error), because a backlog with no cause is found by hand.
 */
export function reportIngest(
  faceDb: DatabaseInstance,
  lastStop: IngestStop,
  now: number = Date.now()
): IngestReport {
  const counts = faceDb
    .prepare('SELECT state, COUNT(*) AS n FROM face_assets WHERE model = ? GROUP BY state')
    .all(FACE_MODEL) as Array<{ state: string; n: number }>;
  const n = (state: string) => counts.find((c) => c.state === state)?.n ?? 0;
  const oldest = faceDb
    .prepare(
      "SELECT MIN(discovered_at) AS t FROM face_assets WHERE state = 'pending' AND model = ?"
    )
    .get(FACE_MODEL) as { t: number | null };
  const causes = faceDb
    .prepare(
      `SELECT substr(last_error, 1, instr(last_error || ':', ':') - 1) AS kind, COUNT(*) AS n
         FROM face_assets WHERE state = 'failed' AND model = ? GROUP BY kind`
    )
    .all(FACE_MODEL) as Array<{ kind: string; n: number }>;
  const report: IngestReport = {
    seeded: !!getFaceStoreState(faceDb, 'seeded_at'),
    pending: n('pending'),
    done: n('done'),
    failed: n('failed'),
    oldestPendingMs: oldest.t === null ? null : now - oldest.t,
    failedCauses: Object.fromEntries(causes.map((c) => [c.kind || 'unknown', c.n])),
    lastStop,
  };
  if (!report.seeded) {
    log.error('face store NOT SEEDED: nothing is ingested until the seed runs (lot A7)', report);
  } else if (
    report.failed > 0 ||
    (report.oldestPendingMs !== null && report.oldestPendingMs > INGEST_OVERDUE_MS)
  ) {
    log.error('face ingestion backlog', report);
  } else {
    log.info('face ingestion', report);
  }
  return report;
}

const TICK_MS = 10 * 60 * 1000;
const REPORT_EVERY_TICKS = 6;
const RECONCILE_EVERY_MS = 24 * 60 * 60 * 1000;
/** Discovery re-reads this much before the last listing, so a slow upload is not missed. */
const DISCOVERY_OVERLAP_MS = 60 * 60 * 1000;

let started = false;

/**
 * Start the worker: every 10 minutes, discover (a full reconciliation at start and daily), then
 * one pass; the report every hour. Does nothing when the store is not configured.
 */
export function startFaceIngestWorker(fetchFn: typeof fetch = fetch): void {
  if (started) {
    return;
  }
  const engine = defaultFaceEngine();
  if (!engine) {
    log.info('face store not configured (FACE_STORE_KEY, FACE_ML_URL): ingestion is off');
    return;
  }
  started = true;
  let ticks = 0;
  let lastReconcile = 0;
  let lastListing: number | null = null;
  let lastStop: IngestStop = null;
  let running = false;

  const tick = async () => {
    if (running) {
      return;
    }
    running = true;
    try {
      const now = Date.now();
      if (getFaceStoreState(engine.faceDb, 'seeded_at')) {
        if (now - lastReconcile >= RECONCILE_EVERY_MS || lastListing === null) {
          await reconcile(fetchFn, engine, now);
          lastReconcile = now;
        } else {
          await discoverNew(
            fetchFn,
            engine.faceDb,
            new Date(lastListing - DISCOVERY_OVERLAP_MS).toISOString(),
            now
          );
        }
        lastListing = now;
      }
      lastStop = (await runIngestPass(fetchFn, engine)).stopped;
    } catch (e) {
      lastStop = e instanceof ImmichUnavailableError ? 'immich_unavailable' : lastStop;
      log.error('face ingest tick failed', e);
    } finally {
      running = false;
    }
    if (ticks++ % REPORT_EVERY_TICKS === 0) {
      try {
        reportIngest(engine.faceDb, lastStop);
      } catch (e) {
        log.error('face ingest report failed', e);
      }
    }
  };
  const first = setTimeout(() => void tick(), 60_000);
  const interval = setInterval(() => void tick(), TICK_MS);
  registerShutdown('face ingest worker', () => {
    clearTimeout(first);
    clearInterval(interval);
  });
  log.info('face ingest worker started');
}
