/**
 * Ingestion (lot A3, docs/wiki/face-matching-option-c.md): every asset of Immich is detected and
 * embedded ONCE, its faces sealed into `faces.db`, then decided by the match engine (A4).
 *
 * DURABLE STATE, NOT A CLOCK. `face_assets` says, per asset, `pending`, `done` or `failed`. A pass
 * takes the pending rows; a restart loses nothing but the pass in flight. The listing that finds
 * new assets is only discovery: the daily full reconciliation is what proves nothing is missed,
 * and it is also what notices an asset deleted from Immich and removes its faces.
 *
 * WHAT STOPS A PASS AND WHAT COUNTS AGAINST AN ASSET. Every failure is classified where it is
 * thrown, as a type. The model service or Immich unreachable (a refusal, a transport failure, a
 * timeout, a body that cannot be read or parsed) is a fact about the service, not the asset: the
 * pass stops, no attempt is counted, the report names the cause. An answer the client cannot
 * trust, a missing preview, or any other error on one asset is a fact about the asset: one
 * attempt, the pass moves on, and after INGEST_MAX_ATTEMPTS the asset is `failed`, reported every
 * hour until someone looks. A preview Immich has not made yet is no attempt: the asset stays
 * pending (Immich's thumbnail queue lags behind uploads).
 *
 * `done` MEANS DECIDED. An asset is marked `done` only after its faces are written AND decided; a
 * decision that throws leaves it pending, and the next pass writes and decides it again.
 *
 * DELETION NEEDS TWO WITNESSES, AT LEAST 20 HOURS APART. An asset missing from ONE full listing
 * is only marked; its faces go when it is missing from two consecutive COUNTING listings, never on
 * a single answer. A listing counts only when `face_store_state.last_counted_listing_at` is at
 * least {@link RECONCILE_COUNT_SPACING_MS} old: durable state, so two deploys or a crash loop
 * (each process start lists in full) add new assets and clear marks, but never count twice.
 *
 * NOT BEFORE THE SEED. Until `face_store_state.seeded_at` exists, nothing is ingested: the seed
 * (A7) imports the faces Immich already computed, and ingesting first would re-embed the whole
 * archive (about 22 hours of the model service) for nothing.
 */

import type { DatabaseInstance } from '#lib/db/database.ts';
import { getFaceStoreState, setFaceStoreState } from '#lib/db/face-database.ts';
import { inTransaction } from '#lib/db/transaction.ts';
import { env } from '#lib/server/env.ts';
import { FACE_MODEL, decodeEmbedding, encodeEmbedding } from '#lib/face-embedding.ts';
import { embeddingContext, seal } from '#lib/server/face-seal.ts';
import { detectFaces, FaceMlResponseError, FaceMlUnavailableError } from '#lib/server/face-ml.ts';
import {
  checkpointFaceStore,
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
export const LIST_MAX_PAGES = 5000;
/** Consecutive complete listings an asset must be missing from before its faces are removed. */
export const RECONCILE_ABSENT_LISTINGS = 2;
/**
 * A full listing counts absences only when the last listing that counted is at least this old.
 * Listings are daily; 20 hours rather than 24 leaves room for a tick that starts a little early.
 */
export const RECONCILE_COUNT_SPACING_MS = 20 * 60 * 60 * 1000;
/** The `face_store_state` key holding when (epoch ms) a listing last counted absences. */
export const LAST_COUNTED_LISTING = 'last_counted_listing_at';
/**
 * A full listing that names fewer than this share of the assets already known is not believed:
 * nothing is removed on its word. Immich losing half its library in a day is not a case to act on
 * blindly; a bug, a wrong key or a partial answer is far likelier.
 */
const RECONCILE_MIN_SHARE = 0.5;

/** Why a pass (or a tick) stopped before its end. `error`: an unexpected failure, logged. */
export type IngestStop = 'ml_unavailable' | 'immich_unavailable' | 'not_seeded' | 'error' | null;

/** Immich answered nothing usable: the pass stops, the asset is not blamed. */
export class ImmichUnavailableError extends Error {
  readonly kind = 'immich_unavailable';
  constructor(message: string) {
    super(message);
    this.name = 'ImmichUnavailableError';
  }
}

/** Read an Immich answer's JSON; a body that cannot be read or parsed is Immich unavailable. */
async function immichJson(res: Response, what: string): Promise<unknown> {
  let text: string;
  try {
    text = await res.text();
  } catch (e) {
    throw new ImmichUnavailableError(
      `${what}: the answer could not be read: ${(e as Error).message}`
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ImmichUnavailableError(`${what}: the answer is not JSON`);
  }
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
  filter: Record<string, unknown>,
  maxPages: number = LIST_MAX_PAGES
): Promise<{ ids: string[]; complete: boolean }> {
  const { base, key } = immich();
  const ids: string[] = [];
  let page: number | null = 1;
  let pages = 0;
  while (page !== null && pages < maxPages) {
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
    const data = (await immichJson(res, 'asset listing')) as {
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
  /** Missing from this listing for the first time: counted, not removed. */
  marked: number;
  removed: number;
  /** Set when removal was refused, with why. */
  refused: string | null;
  /** Whether this listing counted absences (false: refused, or too soon after the last that did). */
  counted: boolean;
}

/**
 * The full reconciliation: list EVERY asset Immich has (trashed ones included: a trashed photo can
 * be restored and keeps its faces), add the unknown as pending, and count, per known asset, the
 * consecutive COUNTING listings it was missing from. The faces of an asset go once it was missing
 * from {@link RECONCILE_ABSENT_LISTINGS} of them in a row - and only from a complete listing that
 * names at least half of what the store knows. A believed listing always clears the marks of what
 * it names; it counts absences only {@link RECONCILE_COUNT_SPACING_MS} after the last one that
 * counted, read from durable state. `maxPages` is the page cap (tests).
 */
export async function reconcile(
  fetchFn: typeof fetch,
  engine: FaceEngine,
  now: number = Date.now(),
  maxPages: number = LIST_MAX_PAGES
): Promise<ReconcileResult> {
  const { ids, complete } = await listAssetIds(fetchFn, { withDeleted: true }, maxPages);
  const added = addPending(engine.faceDb, ids, now);
  const known = engine.faceDb
    .prepare('SELECT asset_id, absent_listings FROM face_assets WHERE model = ?')
    .all(FACE_MODEL) as Array<{ asset_id: string; absent_listings: number }>;
  const present = new Set(ids);
  const missing = known.filter((r) => !present.has(r.asset_id));

  let refused: string | null = null;
  if (!complete) {
    refused = 'the listing hit its page cap';
  } else if (ids.length < known.length * RECONCILE_MIN_SHARE) {
    refused = `the listing names ${ids.length} assets against ${known.length} known`;
  }
  let removed = 0;
  let marked = 0;
  let counted = false;
  if (refused) {
    if (missing.length > 0) {
      log.error('assets missing from Immich NOT counted: the listing is not believed', {
        missing: missing.length,
        refused,
      });
    }
  } else {
    // A believed listing: whatever it names is present again. Whatever it misses is one step
    // nearer removal, but only if the last counting listing is old enough: a second listing the
    // same hour (a restart) is the same witness, not a second one.
    const last = Number(getFaceStoreState(engine.faceDb, LAST_COUNTED_LISTING) ?? Number.NaN);
    counted = Number.isNaN(last) || now - last >= RECONCILE_COUNT_SPACING_MS;
    inTransaction(engine.faceDb, () => {
      const reset = engine.faceDb.prepare(
        'UPDATE face_assets SET absent_listings = 0 WHERE asset_id = ? AND model = ? AND absent_listings > 0'
      );
      for (const id of ids) {
        reset.run(id, FACE_MODEL);
      }
      if (!counted) {
        return;
      }
      const mark = engine.faceDb.prepare(
        'UPDATE face_assets SET absent_listings = absent_listings + 1 WHERE asset_id = ? AND model = ?'
      );
      for (const row of missing) {
        mark.run(row.asset_id, FACE_MODEL);
      }
      setFaceStoreState(engine.faceDb, LAST_COUNTED_LISTING, String(now));
    });
    if (!counted) {
      log.info('listing too soon after the last counted one: absences not counted', {
        missing: missing.length,
        lastCountedMsAgo: now - last,
      });
    }
    const gone = counted
      ? missing.filter((r) => r.absent_listings + 1 >= RECONCILE_ABSENT_LISTINGS)
      : [];
    marked = counted ? missing.length - gone.length : 0;
    for (const { asset_id: assetId } of gone) {
      await runExclusive(() => {
        removeAssetFaces(engine, assetId);
        engine.faceDb
          .prepare('DELETE FROM face_assets WHERE asset_id = ? AND model = ?')
          .run(assetId, FACE_MODEL);
      });
      removed++;
    }
    if (removed > 0) {
      checkpointFaceStore(engine);
    }
  }
  log.info('store reconciled with Immich', {
    listed: ids.length,
    added,
    marked,
    removed,
    refused,
    counted,
  });
  return { listed: ids.length, added, marked, removed, refused, counted };
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
  // has no preview to embed NOW. That is no fault of the asset (Immich's thumbnail queue lags
  // behind an upload), so it counts no attempt and stays pending; a DELETED asset's row and faces
  // are removed by the reconciliation, never on this status alone, and an asset that never gets a
  // preview shows in the hourly report as an overdue pending one.
  if (res.status === 404 || res.status === 400) {
    await res.body?.cancel().catch(() => undefined);
    return 'missing';
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    throw new ImmichUnavailableError(`preview answered ${res.status}`);
  }
  try {
    return await res.blob();
  } catch (e) {
    throw new ImmichUnavailableError(`preview could not be read: ${(e as Error).message}`);
  }
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
    // Pending, no attempt counted; `updated_at` moves so the pass takes the others first.
    engine.faceDb
      .prepare(
        `UPDATE face_assets SET last_error = 'no_preview: Immich has no preview for it yet',
           updated_at = ? WHERE asset_id = ? AND model = ?`
      )
      .run(now, assetId, FACE_MODEL);
    log.info('an asset has no preview yet: left pending', { assetId });
    return 'retry';
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

  // Decided on the float16 round-trip, the exact vector every later re-decision reads from the
  // store: a face decides the same at ingestion and at any rescan.
  const encoded = detected.faces.map((face) => encodeEmbedding(face.embedding));
  const faces: OpenedFace[] = encoded.map((bytes, faceIndex) => ({
    assetId,
    faceIndex,
    embedding: decodeEmbedding(bytes),
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
          seal(engine.key, embeddingContext(assetId, faceIndex, FACE_MODEL), encoded[faceIndex]),
          now
        );
      });
    });
    matchNewFaces(engine, faces);
    // Only now: the faces are written AND decided. A throw above leaves the asset pending.
    engine.faceDb
      .prepare(
        `UPDATE face_assets SET state = 'done', source = 'ml', faces = ?, last_error = NULL,
           attempts = attempts + 1, updated_at = ? WHERE asset_id = ? AND model = ?`
      )
      .run(detected.faces.length, now, assetId, FACE_MODEL);
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

/**
 * Embed up to `limit` pending assets, the least recently tried first: an asset just tried (no
 * preview yet, an attempt counted) goes behind the others, so a few assets that cannot be embedded
 * now never take the whole pass.
 */
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
      "SELECT asset_id FROM face_assets WHERE state = 'pending' AND model = ? ORDER BY updated_at, discovered_at LIMIT ?"
    )
    .all(FACE_MODEL, limit) as Array<{ asset_id: string }>;
  for (const { asset_id } of pending) {
    try {
      result[await ingestAsset(fetchFn, engine, asset_id)]++;
    } catch (e) {
      if (e instanceof FaceMlUnavailableError || e instanceof ImmichUnavailableError) {
        result.stopped =
          e instanceof FaceMlUnavailableError ? 'ml_unavailable' : 'immich_unavailable';
        log.warn('ingest pass stopped: a service is down; no asset is blamed', {
          stopped: result.stopped,
          error: e.message,
        });
        break;
      }
      // Anything else is this asset's: one attempt, and the pass goes on.
      log.error('an asset failed to ingest', e);
      result[countAttempt(engine, asset_id, `error: ${(e as Error).message}`, Date.now())]++;
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
  /**
   * Pending assets that were already tried, grouped by the kind of their last error: `no_preview`
   * (Immich has not made the preview; no attempt counted, so such an asset never becomes `failed`
   * and this count is what names it), or an attempt that will be retried.
   */
  pendingCauses: Record<string, number>;
  lastStop: IngestStop;
}

/**
 * The hourly report. An error when an asset failed, when an asset waits more than a day, or when
 * the store is not seeded; it NAMES the cause (the last stop of a pass, and the failed assets
 * grouped by the kind of their last error), because a backlog with no cause is found by hand.
 * The pending assets already tried are grouped the same way, so an asset that never gets a preview
 * is named by its cause and not only by the age alarm.
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
  const causesOf = (state: 'failed' | 'pending') =>
    Object.fromEntries(
      (
        faceDb
          .prepare(
            `SELECT substr(last_error, 1, instr(last_error || ':', ':') - 1) AS kind, COUNT(*) AS n
               FROM face_assets WHERE state = ? AND model = ? AND last_error IS NOT NULL
               GROUP BY kind`
          )
          .all(state, FACE_MODEL) as Array<{ kind: string; n: number }>
      ).map((c) => [c.kind || 'unknown', c.n])
    );
  const report: IngestReport = {
    seeded: !!getFaceStoreState(faceDb, 'seeded_at'),
    pending: n('pending'),
    done: n('done'),
    failed: n('failed'),
    oldestPendingMs: oldest.t === null ? null : now - oldest.t,
    failedCauses: causesOf('failed'),
    pendingCauses: causesOf('pending'),
    lastStop,
  };
  if (!report.seeded) {
    // A planned state until lot A7 seeds the store, not a fault: said, never accused.
    log.info('face store not seeded yet: nothing is ingested until the seed (lot A7)', report);
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
      if (e instanceof ImmichUnavailableError) {
        lastStop = 'immich_unavailable';
        log.warn('face ingest tick stopped: Immich is unavailable', { error: e.message });
      } else {
        lastStop = 'error';
        log.error('face ingest tick failed', e);
      }
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
