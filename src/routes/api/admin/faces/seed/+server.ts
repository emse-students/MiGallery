import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireScope } from '#lib/server/permissions.ts';
import { isImpersonating } from '#lib/server/auth.ts';
import { defaultFaceEngine } from '#lib/server/face-engine.ts';
import {
  beginSeed,
  readSeedFinish,
  seedAssets,
  seedFaces,
  startSeedFinish,
  SeedRefusedError,
  type SeedExpected,
  type SeedFace,
} from '#lib/server/face-seed.ts';
import { createLogger } from '#lib/server/logger.ts';
import { readJsonBody } from '#lib/server/route-errors.ts';

const log = createLogger('face-seed-route');

/** Faces accepted per request (about 10 MB of JSON, under BODY_SIZE_LIMIT). */
const MAX_FACES = 2000;
/** Asset ids accepted per request. */
const MAX_ASSETS = 20000;

type Body =
  | { phase: 'begin' }
  | { phase: 'assets'; run: unknown; ids: unknown }
  | { phase: 'faces'; run: unknown; faces: unknown }
  | { phase: 'finish'; run: unknown; expected: unknown; dryRun: unknown };

const isText = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length < 100;
const isInt = (v: unknown): v is number => Number.isInteger(v);
const isCount = (v: unknown): v is number => isInt(v) && (v as number) >= 0;

/** The run token `begin` returned; a phase without one is the client's error (400). */
function readRun(raw: unknown): string {
  if (!isText(raw)) {
    throw error(400, 'run: the token begin returned');
  }
  return raw;
}

/** The counts Immich gave before the export streamed; the finish compares them. */
function readExpected(raw: unknown): SeedExpected {
  const e = raw as Record<string, unknown> | null;
  if (!e || !isCount(e.assets) || !isCount(e.faces)) {
    throw error(400, 'expected: { assets, faces }, the counts Immich gave before the export');
  }
  return { assets: e.assets, faces: e.faces };
}

/** Admin scope, never an impersonated session, and a configured store. */
async function seedEngine(event: Parameters<RequestHandler>[0]) {
  await requireScope(event, 'admin');
  if (isImpersonating(event)) {
    throw error(403, 'not while impersonating');
  }
  const engine = defaultFaceEngine();
  if (!engine) {
    throw error(503, 'the face store is not configured');
  }
  return engine;
}

/** A seed refusal is a 409 naming its reason; anything else goes on as thrown. */
function refusalToHttp(e: unknown): never {
  if (e instanceof SeedRefusedError) {
    log.warn('seed refused', { reason: e.reason });
    throw error(409, e.reason);
  }
  throw e;
}

/** A face as sent, checked field by field; null when any field is wrong. */
function readFace(raw: unknown): SeedFace | null {
  const f = raw as Record<string, unknown> | null;
  if (
    !f ||
    !isText(f.assetId) ||
    !(f.personId === null || isText(f.personId)) ||
    ![f.imageWidth, f.imageHeight, f.x1, f.y1, f.x2, f.y2].every(isInt) ||
    !Array.isArray(f.embedding) ||
    !f.embedding.every((v) => typeof v === 'number')
  ) {
    return null;
  }
  return f as unknown as SeedFace;
}

/**
 * POST /api/admin/faces/seed - lot A7's one-shot seed of the face store from Immich's vectors
 * (src/lib/server/face-seed.ts, driven by scripts/faces/seed-client.mjs). Admin scope, never an
 * impersonated session. `begin` answers the run token every later phase carries; `finish` (or its
 * dry run, `dryRun: true`) answers 202 at once and runs in the background, polled with GET. It
 * answers counts only: no vector, no id ever goes back out.
 */
export const POST: RequestHandler = async (event) => {
  const engine = await seedEngine(event);
  const body = await readJsonBody<Body>(event.request);
  log.debug('seed phase', { phase: body?.phase });
  try {
    switch (body?.phase) {
      case 'begin':
        return json({ success: true, run: await beginSeed(engine) });
      case 'assets': {
        const run = readRun(body.run);
        const ids = body.ids;
        if (!Array.isArray(ids) || ids.length > MAX_ASSETS || !ids.every(isText)) {
          throw error(400, `ids: up to ${MAX_ASSETS} asset ids`);
        }
        return json({ success: true, added: await seedAssets(engine, run, ids) });
      }
      case 'faces': {
        const run = readRun(body.run);
        const raw = body.faces;
        if (!Array.isArray(raw) || raw.length > MAX_FACES) {
          throw error(400, `faces: up to ${MAX_FACES}`);
        }
        const faces = raw.map(readFace);
        if (faces.some((f) => f === null)) {
          throw error(400, 'faces: a face is malformed');
        }
        return json({ success: true, ...(await seedFaces(engine, run, faces as SeedFace[])) });
      }
      case 'finish': {
        const run = readRun(body.run);
        const expected = readExpected(body.expected);
        if (body.dryRun !== undefined && typeof body.dryRun !== 'boolean') {
          throw error(400, 'dryRun: a boolean');
        }
        const dryRun = body.dryRun === true;
        await startSeedFinish(engine, run, expected, dryRun);
        return json({ success: true, status: 'running', dryRun }, { status: 202 });
      }
      default:
        throw error(400, 'phase: begin, assets, faces or finish');
    }
  } catch (e) {
    refusalToHttp(e);
  }
};

/**
 * GET /api/admin/faces/seed?run=<token> - the durable outcome of the run's finish: `none`,
 * `running`, `done` with the aggregate report, or `failed` with a classified reason (`interrupted`
 * when a restart cut it). Same access as POST; a token of a replaced run is a 409 `stale_run`.
 */
export const GET: RequestHandler = async (event) => {
  const engine = await seedEngine(event);
  const run = readRun(event.url.searchParams.get('run'));
  try {
    return json({ success: true, ...readSeedFinish(engine, run) });
  } catch (e) {
    refusalToHttp(e);
  }
};
