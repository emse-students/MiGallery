/**
 * The step-up (`#lib/server/step-up.ts`): a session a Canari handoff opened may browse and may
 * change nothing until a MiConnect sign-in. Pinned against the REAL route tree: every handler that
 * changes state is refused to a marked session unless it is on the exemption list, and every
 * exemption names a route that exists - so a route added tomorrow is guarded without anyone
 * remembering it, and a stale exemption cannot linger.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { STEP_UP_EXEMPT, stepUpRequired, stepUpResponse } from '#lib/server/step-up.ts';
import { isStepUpRefusal, STEP_UP_CODE } from '#lib/step-up.ts';

const ROUTES = join(__dirname, '..', 'src', 'routes');
const STATE_CHANGING = ['POST', 'PUT', 'PATCH', 'DELETE'];

function serverFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return serverFiles(p);
    return name === '+server.ts' ? [p] : [];
  });
}

/** The URL path a route file answers, with each parameter given a sample value. */
function pathOf(file: string): string {
  const segments = relative(ROUTES, file).split(sep).slice(0, -1);
  const parts = segments
    .filter((s) => !/^\(.*\)$/.test(s))
    .map((s) => (s.startsWith('[...') ? 'a/b' : s.startsWith('[') ? 'sample' : s));
  return `/${parts.join('/')}`;
}

/** The state-changing methods a route file exports (`export const POST`, or `export { x as POST }`). */
function writesOf(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  return STATE_CHANGING.filter((m) =>
    new RegExp(`export\\s+(const|async function|function)\\s+${m}\\b|\\bas\\s+${m}\\b`).test(src)
  );
}

const routes = serverFiles(ROUTES).map((f) => ({ path: pathOf(f), methods: writesOf(f) }));
const writing = routes.filter((r) => r.methods.length > 0);

describe('the step-up guard', () => {
  it('finds the state-changing routes (the enumeration is not empty)', () => {
    expect(writing.length).toBeGreaterThan(30);
  });

  it('refuses every state-changing route to a marked session, except the listed exemptions', () => {
    const letThrough: string[] = [];
    for (const r of writing) {
      for (const m of r.methods) {
        if (!stepUpRequired(m, r.path, true) && !STEP_UP_EXEMPT.has(r.path)) {
          letThrough.push(`${m} ${r.path}`);
        }
        if (STEP_UP_EXEMPT.has(r.path)) expect(stepUpRequired(m, r.path, true)).toBe(false);
      }
    }
    expect(letThrough).toEqual([]);
  });

  it('guards the actions the design names, by path', () => {
    for (const p of [
      '/api/users/me/face/enrolment',
      '/api/users/me/face',
      '/api/users/me/face/matches',
      '/api/users/me/face/rejections',
      '/api/users/me/photo-access',
      '/api/albums/sample/permissions/users',
      '/api/favorites',
      '/api/users/me/profile-photo',
    ]) {
      expect([p, stepUpRequired('POST', p, true)]).toEqual([p, true]);
    }
  });

  it('names, for every exemption, a state-changing route that exists', () => {
    for (const path of STEP_UP_EXEMPT.keys()) {
      expect(
        writing.some((r) => r.path === path),
        path
      ).toBe(true);
    }
  });

  it('never touches an unmarked session, nor a read', () => {
    for (const r of writing) {
      for (const m of r.methods) expect(stepUpRequired(m, r.path, false)).toBe(false);
      expect(stepUpRequired('GET', r.path, true)).toBe(false);
      expect(stepUpRequired('HEAD', r.path, true)).toBe(false);
    }
  });

  it('answers a refusal the browser recognises without reading its body', async () => {
    const res = stepUpResponse();
    expect(res.status).toBe(403);
    expect(isStepUpRefusal(res)).toBe(true);
    expect(await res.json()).toEqual({ code: STEP_UP_CODE });
    expect(isStepUpRefusal(new Response('{}', { status: 403 }))).toBe(false);
  });
});
