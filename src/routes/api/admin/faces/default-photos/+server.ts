import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireScope } from '#lib/server/permissions.ts';
import { isImpersonating } from '#lib/server/auth.ts';
import { defaultFaceEngine } from '#lib/server/face-engine.ts';
import { normalisePersonId } from '#lib/server/person-id.ts';
import {
  runDefaultProfilePhotos,
  type DefaultReport,
  type FeaturedFace,
} from '#lib/server/profile-photo-default.ts';
import { createLogger } from '#lib/server/logger.ts';
import { readJsonBody } from '#lib/server/route-errors.ts';

const log = createLogger('default-photos-route');

/** Featured faces accepted in one request: one per linked person, a few hundred in practice. */
const MAX_FEATURED = 5000;
/** Asset ids accepted in `present` (about 172k in production, ~7 MB of JSON under the 64M limit). */
const MAX_PRESENT = 2_000_000;
const ASSET_ID = /^[\w-]{1,64}$/;

/** The run in this process: none, running, or its end. Counts only. */
let last: {
  status: 'running' | 'done' | 'failed';
  dryRun: boolean;
  report?: DefaultReport;
} | null = null;
/** The run in this process while it goes (what a test awaits instead of polling). */
let running: Promise<void> = Promise.resolve();

/** The end of the run this process started last, or a settled promise. Never rejects. */
export function _runSettled(): Promise<void> {
  return running;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** One featured face as sent, checked field by field; null when any field is wrong. */
function readFeatured(raw: unknown): [string, FeaturedFace] | null {
  const f = raw as Record<string, unknown> | null;
  const person = normalisePersonId(typeof f?.person === 'string' ? f.person : '');
  if (
    !f ||
    !person ||
    typeof f.assetId !== 'string' ||
    !ASSET_ID.test(f.assetId) ||
    ![f.x1, f.y1, f.x2, f.y2, f.imgW, f.imgH].every(isNum)
  ) {
    return null;
  }
  return [
    person,
    {
      assetId: f.assetId,
      x1: f.x1 as number,
      y1: f.y1 as number,
      x2: f.x2 as number,
      y2: f.y2 as number,
      imgW: f.imgW as number,
      imgH: f.imgH as number,
    },
  ];
}

async function adminEngine(event: Parameters<RequestHandler>[0]) {
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

/**
 * POST /api/admin/faces/default-photos
 * The one-off run of the default profile photo (profile-photo-default.ts) over every enrolled
 * member: `{ featured?: [{ person, assetId, x1, y1, x2, y2, imgW, imgH }], present?: [assetId],
 * dryRun?: boolean }`, `featured` being the face Immich featured for each person and `present`
 * every asset id Immich's table still holds, locked included (scripts/faces/default-photos-client.mjs
 * reads both from Immich's database): the only evidence that a chosen photo is deleted, since the
 * API answers one 400 for deleted and locked. Without `present`, a choice goes only when trashed. Answers 202 at once and runs in the background (minutes:
 * one Immich read per member); `GET` returns its state and its counts. 409 while one runs.
 * Idempotent: a second run keeps what the first set, and never touches a valid choice.
 */
export const POST: RequestHandler = async (event) => {
  const engine = await adminEngine(event);
  const body = await readJsonBody<{ featured?: unknown; present?: unknown; dryRun?: unknown }>(
    event.request
  );
  const rawFeatured = body.featured ?? [];
  if (!Array.isArray(rawFeatured) || rawFeatured.length > MAX_FEATURED) {
    throw error(400, `featured: an array of at most ${MAX_FEATURED} faces`);
  }
  const featured = new Map<string, FeaturedFace>();
  for (const raw of rawFeatured) {
    const entry = readFeatured(raw);
    if (!entry) {
      throw error(400, 'featured: { person, assetId, x1, y1, x2, y2, imgW, imgH }');
    }
    featured.set(entry[0], entry[1]);
  }
  let present: Set<string> | null = null;
  if (body.present !== undefined) {
    if (
      !Array.isArray(body.present) ||
      body.present.length === 0 ||
      body.present.length > MAX_PRESENT ||
      !body.present.every((id) => typeof id === 'string' && ASSET_ID.test(id))
    ) {
      throw error(400, `present: a non-empty array of at most ${MAX_PRESENT} asset ids`);
    }
    present = new Set(body.present as string[]);
  }
  const dryRun = body.dryRun === true;
  // Checked and taken with NO await in between (every await is above): two POSTs at once cannot
  // both see "not running".
  if (last?.status === 'running') {
    throw error(409, 'running');
  }
  last = { status: 'running', dryRun };
  log.info('default profile photos started', {
    featured: featured.size,
    present: present?.size ?? 0,
    dryRun,
  });
  // The global fetch: the run outlives this request.
  running = runDefaultProfilePhotos(engine, fetch, featured, dryRun, present).then(
    (report) => {
      last = { status: 'done', dryRun, report };
    },
    (e: unknown) => {
      last = { status: 'failed', dryRun };
      log.error('default profile photos run failed', e);
    }
  );
  return json({ success: true, status: 'running', dryRun }, { status: 202 });
};

/** GET /api/admin/faces/default-photos: the run of this process, `{ status, dryRun, report }`. */
export const GET: RequestHandler = async (event) => {
  await adminEngine(event);
  return json({ success: true, ...(last ?? { status: 'idle' }) });
};
