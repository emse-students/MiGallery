/**
 * Lot A5's routes, called as HANDLERS against throwaway SQLite files with the session helpers
 * scripted and the model service faked: POST and GET /api/users/me/face/enrolment, and POST
 * /api/users/me/face/matches. Every case asserts the status AND what was (not) stored; no
 * response may carry a vector. SYNTHETIC vectors only.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeTempDir } from './test-helpers';
import { FACE_EMBEDDING_DIM } from '#lib/face-embedding.ts';

const state = vi.hoisted(() => ({
  user: null as null | { id_user: string; role: string },
  impersonating: false,
}));

vi.mock('#lib/server/env.ts', () => ({
  env: {
    IMMICH_BASE_URL: 'http://immich.test',
    IMMICH_API_KEY: 'k',
    FACE_ML_URL: 'http://ml.test',
    FACE_STORE_KEY: 'ab'.repeat(32),
  },
}));
vi.mock('#lib/server/permissions.ts', () => ({
  requireScope: async () => {
    if (!state.user) throw Object.assign(new Error('unauthorized'), { status: 401 });
    return { user: state.user, grantedScope: 'read', viaApiKey: false };
  },
}));
vi.mock('#lib/server/auth.ts', () => ({
  isImpersonating: () => state.impersonating,
  getRequestSession: () => null,
}));

function vector(seed: number): number[] {
  let a = seed >>> 0;
  return Array.from({ length: FACE_EMBEDDING_DIM }, () => {
    a = (a * 1664525 + 1013904223) >>> 0;
    return a / 2 ** 32 - 0.5;
  });
}

/** What the fake model service answers next: faces as [score, seed], or a transport failure. */
let modelFaces: Array<[number, number]> = [];
let modelDown = false;

const modelFetch = (async (url: string) => {
  if (!String(url).endsWith('/predict')) return new Response('unexpected', { status: 599 });
  if (modelDown) throw new TypeError('connect ECONNREFUSED');
  return Response.json({
    imageWidth: 640,
    imageHeight: 480,
    'facial-recognition': modelFaces.map(([score, seed], i) => ({
      boundingBox: { x1: i, y1: i, x2: i + 50, y2: i + 50 },
      score,
      embedding: JSON.stringify(vector(seed)),
    })),
  });
}) as unknown as typeof fetch;

let database: typeof import('#lib/db/database.ts');
let faceDatabase: typeof import('#lib/db/face-database.ts');
let engineMod: typeof import('#lib/server/face-engine.ts');
let enrolRoute: typeof import('../src/routes/api/users/me/face/enrolment/+server');
let matchRoute: typeof import('../src/routes/api/users/me/face/matches/+server');
let dbDir: string;

const db = () => database.getDatabase();

function selfieRequest(fields: Record<string, string | Blob>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return new Request('http://x.test/', { method: 'POST', body: form });
}

async function call(fn: unknown, event: object): Promise<{ status: number; body: unknown }> {
  try {
    const res = (await (fn as (e: never) => Promise<Response>)(event as never)) as Response;
    return { status: res.status, body: await res.json().catch(() => null) };
  } catch (e) {
    return { status: (e as { status?: number }).status ?? 500, body: null };
  }
}

const enrol = (fields: Record<string, string | Blob>) =>
  call(enrolRoute.POST, { request: selfieRequest(fields), fetch: modelFetch });

const references = () =>
  (
    db().prepare("SELECT COUNT(*) AS n FROM face_references WHERE user_id = 'm1'").get() as {
      n: number;
    }
  ).n;
const consents = () =>
  db()
    .prepare("SELECT source FROM face_consents WHERE user_id = 'm1' AND withdrawn_at IS NULL")
    .all();

/** Wait for the background re-match an enrolment queued. */
const idle = () => engineMod.runExclusive(() => undefined);

beforeAll(async () => {
  dbDir = mkdtempSync(join(tmpdir(), 'migallery-face-enrol-'));
  process.env.DATABASE_PATH = join(dbDir, 'migallery.db');
  database = await import('#lib/db/database.ts');
  faceDatabase = await import('#lib/db/face-database.ts');
  engineMod = await import('#lib/server/face-engine.ts');
  enrolRoute = await import('../src/routes/api/users/me/face/enrolment/+server');
  matchRoute = await import('../src/routes/api/users/me/face/matches/+server');
});

afterAll(() => {
  faceDatabase.resetFaceDatabase();
  database.resetDatabase();
  removeTempDir(dbDir);
});

beforeEach(() => {
  db().exec(
    'DELETE FROM face_matches; DELETE FROM face_references; DELETE FROM face_consents; DELETE FROM users;'
  );
  db().prepare("INSERT INTO users (id_user, name) VALUES ('m1', 'm1')").run();
  state.user = { id_user: 'm1', role: 'user' };
  state.impersonating = false;
  modelFaces = [[0.95, 1]];
  modelDown = false;
});

describe('POST /api/users/me/face/enrolment', () => {
  const selfie = () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });

  it('stores one sealed reference and the consent, and answers no vector', async () => {
    const res = await enrol({ selfie: selfie(), consent: 'true' });
    await idle();
    expect(res).toEqual({ status: 200, body: { success: true, enrolled: true, references: 1 } });
    expect(references()).toBe(1);
    expect(consents()).toEqual([{ source: 'selfie' }]);
  });

  it('refuses without the agreement, and stores nothing', async () => {
    const res = await enrol({ selfie: selfie() });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe('consent_required');
    expect(references()).toBe(0);
    expect(consents()).toEqual([]);
  });

  it('refuses a selfie with a second face, and stores nothing', async () => {
    modelFaces = [
      [0.95, 1],
      [0.55, 2],
    ];
    const res = await enrol({ selfie: selfie(), consent: 'true' });
    expect(res.status).toBe(422);
    expect((res.body as { error: string }).error).toBe('several_faces');
    expect(references()).toBe(0);
    expect(consents()).toEqual([]);
  });

  it('refuses a selfie with no face', async () => {
    modelFaces = [];
    const res = await enrol({ selfie: selfie(), consent: 'true' });
    expect(res.status).toBe(422);
    expect((res.body as { error: string }).error).toBe('no_face');
  });

  it('says the service is unavailable when the model does not answer, and stores nothing', async () => {
    modelDown = true;
    const res = await enrol({ selfie: selfie(), consent: 'true' });
    expect(res.status).toBe(503);
    expect(references()).toBe(0);
    expect(consents()).toEqual([]);
  });

  it('refuses a picture over the size cap before the model sees it', async () => {
    modelDown = true; // would be a 503 if the picture reached the model
    const big = new Blob([new Uint8Array(15 * 1024 * 1024 + 1)]);
    expect((await enrol({ selfie: big, consent: 'true' })).status).toBe(413);
  });

  it('refuses an impersonated session and an anonymous one', async () => {
    state.impersonating = true;
    expect((await enrol({ selfie: selfie(), consent: 'true' })).status).toBe(403);
    state.impersonating = false;
    state.user = null;
    expect((await enrol({ selfie: selfie(), consent: 'true' })).status).toBe(401);
    expect(references()).toBe(0);
  });
});

describe('GET /api/users/me/face/enrolment', () => {
  it('says whether the member is enrolled and how many references, never one of them', async () => {
    const before = await call(enrolRoute.GET, { request: new Request('http://x.test/') });
    expect(before).toEqual({
      status: 200,
      body: { success: true, enrolled: false, references: 0 },
    });
    await enrol({ selfie: new Blob([new Uint8Array([1])]), consent: 'true' });
    await idle();
    const after = await call(enrolRoute.GET, { request: new Request('http://x.test/') });
    expect(after.body).toEqual({ success: true, enrolled: true, references: 1 });
  });
});

describe('POST /api/users/me/face/matches', () => {
  const answer = (body: unknown) =>
    call(matchRoute.POST, {
      request: new Request('http://x.test/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    });

  it('refuses a malformed answer', async () => {
    expect((await answer({ asset_id: 'a', face_index: -1, verdict: 'confirm' })).status).toBe(400);
    expect((await answer({ asset_id: 'a', face_index: 0, verdict: 'maybe' })).status).toBe(400);
    expect((await answer({ face_index: 0, verdict: 'reject' })).status).toBe(400);
  });

  it('refuses a body that is not JSON, and an enrolment that is not a form, as 400', async () => {
    const notJson = await call(matchRoute.POST, {
      request: new Request('http://x.test/', { method: 'POST', body: '{' }),
    });
    expect(notJson.status).toBe(400);
    const notForm = await call(enrolRoute.POST, {
      request: new Request('http://x.test/', { method: 'POST', body: '{' }),
      fetch: modelFetch,
    });
    expect(notForm.status).toBe(400);
    expect(references()).toBe(0);
  });

  it('is 404 on a face the member does not hold', async () => {
    expect((await answer({ asset_id: 'a', face_index: 0, verdict: 'confirm' })).status).toBe(404);
  });

  it('records the answer on a face the member holds', async () => {
    db()
      .prepare(
        `INSERT INTO face_matches (asset_id, face_index, model, user_id, distance, runner_up, band,
           state, created_at) VALUES ('a', 0, 'buffalo_l', 'm1', 0.55, NULL, 'suggested', 'pending', 1)`
      )
      .run();
    const res = await answer({ asset_id: 'a', face_index: 0, verdict: 'reject' });
    expect(res).toEqual({ status: 200, body: { success: true, outcome: 'rejected' } });
    expect(db().prepare('SELECT state FROM face_matches').get()).toEqual({ state: 'rejected' });
  });

  it('refuses an impersonated session', async () => {
    state.impersonating = true;
    expect((await answer({ asset_id: 'a', face_index: 0, verdict: 'confirm' })).status).toBe(403);
  });
});
