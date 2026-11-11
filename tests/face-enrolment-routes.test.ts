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
import { FACE_EMBEDDING_DIM, FACE_MODEL } from '#lib/face-embedding.ts';

const state = vi.hoisted(() => ({
  user: null as null | { id_user: string; role: string },
  impersonating: false,
  /** What the faked selection phase waits for (the real one reads Immich). */
  upgradeGate: Promise.resolve() as Promise<void>,
}));

vi.mock('#lib/server/face-reference-upgrade.ts', async (importActual) => ({
  ...(await importActual<typeof import('#lib/server/face-reference-upgrade.ts')>()),
  upgradeMemberReferences: async () => {
    await state.upgradeGate;
    return 'already';
  },
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
/** A status the fake model answers instead of a result (null: it answers). */
let modelStatus: number | null = null;
let modelCalls = 0;

const modelFetch = (async (url: string) => {
  if (!String(url).endsWith('/predict')) return new Response('unexpected', { status: 599 });
  modelCalls++;
  if (modelDown) throw new TypeError('connect ECONNREFUSED');
  if (modelStatus !== null) return new Response('{}', { status: modelStatus });
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
let enrolmentMod: typeof import('#lib/server/face-enrolment.ts');
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
  enrolmentMod = await import('#lib/server/face-enrolment.ts');
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
  modelStatus = null;
  modelCalls = 0;
  enrolmentMod.enrolLimiter.reset();
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

  it("answers 422 when the model refuses the picture itself (the client's), and stores nothing", async () => {
    for (const status of [400, 413, 415, 422]) {
      modelStatus = status;
      const res = await enrol({ selfie: selfie(), consent: 'true' });
      expect(res.status).toBe(422);
      expect((res.body as { error: string }).error).toBe('selfie_unreadable');
    }
    expect(references()).toBe(0);
    expect(consents()).toEqual([]);
  });

  it('says the service is unavailable on a 5xx, or a 4xx that is not about the picture', async () => {
    for (const status of [500, 502, 404, 429]) {
      modelStatus = status;
      const res = await enrol({ selfie: selfie(), consent: 'true' });
      expect(res.status).toBe(503);
      expect((res.body as { error: string }).error).toBe('face_unavailable');
    }
    expect(references()).toBe(0);
  });

  it('answers 429 past the hourly limit of a member, before the model is called', async () => {
    for (let i = 0; i < enrolmentMod.ENROL_LIMIT_PER_HOUR; i++) {
      expect((await enrol({ selfie: selfie(), consent: 'true' })).status).toBe(200);
    }
    expect(modelCalls).toBe(enrolmentMod.ENROL_LIMIT_PER_HOUR);
    const res = await enrol({ selfie: selfie(), consent: 'true' });
    expect(res.status).toBe(429);
    expect((res.body as { error: string; message: string }).error).toBe('too_many_requests');
    expect((res.body as { message: string }).message.length).toBeGreaterThan(0);
    expect(modelCalls).toBe(enrolmentMod.ENROL_LIMIT_PER_HOUR);
    // Another member keeps their own window.
    db().prepare("INSERT INTO users (id_user, name) VALUES ('m2', 'm2')").run();
    state.user = { id_user: 'm2', role: 'user' };
    expect((await enrol({ selfie: selfie(), consent: 'true' })).status).toBe(200);
    await idle();
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
  const read = () => call(enrolRoute.GET, { request: new Request('http://x.test/') });
  const insertMatch = (asset: string, band: string, st: string) =>
    db()
      .prepare(
        `INSERT INTO face_matches (asset_id, face_index, model, user_id, distance, runner_up, band, state, created_at)
         VALUES (?, 0, ?, 'm1', 0.3, NULL, ?, ?, 1)`
      )
      .run(asset, FACE_MODEL, band, st);

  it('says whether the member is enrolled and how many references, never one of them', async () => {
    const before = await read();
    expect(before).toEqual({
      status: 200,
      body: {
        success: true,
        enrolled: false,
        references: 0,
        matching: false,
        photos: 0,
        toConfirm: 0,
      },
    });
    await enrol({ selfie: new Blob([new Uint8Array([1])]), consent: 'true' });
    await idle();
    const after = await read();
    expect(after.body).toMatchObject({ enrolled: true, references: 1, matching: false });
  });

  it('counts the visible photos and the faces to confirm, and nothing else', async () => {
    insertMatch('a1', 'auto', 'pending');
    insertMatch('a2', 'suggested', 'confirmed');
    insertMatch('a3', 'suggested', 'pending');
    insertMatch('a4', 'suggested', 'pending');
    insertMatch('a5', 'auto', 'rejected');
    expect((await read()).body).toMatchObject({ photos: 2, toConfirm: 2 });
  });

  it('reports matching from the selfie until its re-match has run, and not after', async () => {
    // Hold the engine lock so the re-match the enrolment queues cannot start yet.
    let release!: () => void;
    const held = engineMod.runExclusive(() => new Promise<void>((r) => (release = r)));
    await enrol({ selfie: new Blob([new Uint8Array([1])]), consent: 'true' });
    expect(((await read()).body as { matching: boolean }).matching).toBe(true);
    release();
    await held;
    await idle();
    expect(((await read()).body as { matching: boolean }).matching).toBe(false);
  });

  it('stays matching through the selection that follows the re-match, and ends after it', async () => {
    let releaseUpgrade!: () => void;
    state.upgradeGate = new Promise<void>((r) => (releaseUpgrade = r));
    try {
      await enrol({ selfie: new Blob([new Uint8Array([1])]), consent: 'true' });
      await idle(); // the re-match itself is over; the selection is still owed
      expect(((await read()).body as { matching: boolean }).matching).toBe(true);
      releaseUpgrade();
      await vi.waitFor(async () =>
        expect(((await read()).body as { matching: boolean }).matching).toBe(false)
      );
    } finally {
      releaseUpgrade();
      state.upgradeGate = Promise.resolve();
    }
  });

  it('keeps matching while two overlapping follow-ups are owed, until both end', async () => {
    const gates: Array<() => void> = [];
    state.upgradeGate = new Promise<void>((r) => gates.push(r));
    const body = () => ({ selfie: new Blob([new Uint8Array([1])]), consent: 'true' });
    try {
      await enrol(body());
      await idle();
      const second = new Promise<void>((r) => gates.push(r));
      state.upgradeGate = second;
      await enrol(body());
      await idle();
      gates[0](); // the first follow-up ends; the second is still owed
      await new Promise((r) => setTimeout(r, 20));
      expect(((await read()).body as { matching: boolean }).matching).toBe(true);
      gates[1]();
      await vi.waitFor(async () =>
        expect(((await read()).body as { matching: boolean }).matching).toBe(false)
      );
    } finally {
      gates.forEach((g) => g());
      state.upgradeGate = Promise.resolve();
    }
  });

  it('is matching while the durable re-match row of a selection exists', async () => {
    db()
      .prepare('INSERT INTO face_rematch_pending (user_id, model, since) VALUES (?, ?, 1)')
      .run('m1', FACE_MODEL);
    expect(((await read()).body as { matching: boolean }).matching).toBe(true);
    db().prepare('DELETE FROM face_rematch_pending').run();
    expect(((await read()).body as { matching: boolean }).matching).toBe(false);
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
    expect(res).toEqual({
      status: 200,
      body: { success: true, outcome: 'rejected', released: [], promoted: [] },
    });
    expect(db().prepare('SELECT state FROM face_matches').get()).toEqual({ state: 'rejected' });
  });

  it('refuses an impersonated session', async () => {
    state.impersonating = true;
    expect((await answer({ asset_id: 'a', face_index: 0, verdict: 'confirm' })).status).toBe(403);
  });
});
