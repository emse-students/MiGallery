import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireScope } from '#lib/server/permissions.ts';
import { isImpersonating } from '#lib/server/auth.ts';
import { defaultFaceEngine } from '#lib/server/face-engine.ts';
import {
  beginSeed,
  finishSeed,
  seedAssets,
  seedFaces,
  SeedRefusedError,
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
  | { phase: 'assets'; ids: unknown }
  | { phase: 'faces'; faces: unknown }
  | { phase: 'finish' };

const isText = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length < 100;
const isInt = (v: unknown): v is number => Number.isInteger(v);

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
 * impersonated session. It answers counts only: no vector, no id ever goes back out.
 */
export const POST: RequestHandler = async (event) => {
  await requireScope(event, 'admin');
  if (isImpersonating(event)) {
    throw error(403, 'not while impersonating');
  }
  const engine = defaultFaceEngine();
  if (!engine) {
    throw error(503, 'the face store is not configured');
  }
  const body = await readJsonBody<Body>(event.request);
  try {
    switch (body?.phase) {
      case 'begin':
        await beginSeed(engine);
        return json({ success: true });
      case 'assets': {
        const ids = body.ids;
        if (!Array.isArray(ids) || ids.length > MAX_ASSETS || !ids.every(isText)) {
          throw error(400, `ids: up to ${MAX_ASSETS} asset ids`);
        }
        return json({ success: true, added: await seedAssets(engine, ids) });
      }
      case 'faces': {
        const raw = body.faces;
        if (!Array.isArray(raw) || raw.length > MAX_FACES) {
          throw error(400, `faces: up to ${MAX_FACES}`);
        }
        const faces = raw.map(readFace);
        if (faces.some((f) => f === null)) {
          throw error(400, 'faces: a face is malformed');
        }
        return json({ success: true, ...(await seedFaces(engine, faces as SeedFace[])) });
      }
      case 'finish':
        return json({ success: true, report: await finishSeed(engine) });
      default:
        throw error(400, 'phase: begin, assets, faces or finish');
    }
  } catch (e) {
    if (e instanceof SeedRefusedError) {
      log.warn('seed refused', { reason: e.reason });
      throw error(409, e.reason);
    }
    throw e;
  }
};
