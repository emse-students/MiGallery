/**
 * THE STEP-UP - the decisive answer to login CSRF through the Canari sign-in handoff
 * (docs/wiki/authentication.md, "Signed in from Canari").
 *
 * A handoff token can be minted by anyone with a Canari account and carried to a victim's browser,
 * which then holds a session AS THE ATTACKER. So a session a handoff opened (`via_handoff`) may
 * BROWSE and may change NOTHING - no face enrolment, no consent or its withdrawal, no grant or
 * share, no "C'est moi" answer, no upload, no favourite - until the user signs in through MiConnect
 * in this browser, which names who is signing in and replaces the marked session with an unmarked
 * one (`/api/auth/callback`).
 *
 * DEFAULT DENY: every state-changing request from a marked session is refused, whatever its path,
 * except the short list below of requests that write nothing into the account a session names.
 * A new route is guarded without anyone remembering to guard it; `tests/step-up.test.ts`
 * enumerates every state-changing route and fails on an exemption that names no route.
 */
import { STEP_UP_CODE, STEP_UP_HEADER } from '#lib/step-up.ts';

/** The methods that change state. GET, HEAD and OPTIONS never do here. */
const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * The requests a marked session may still make, each with why it writes nothing that matters.
 * Exact paths, never prefixes.
 */
export const STEP_UP_EXEMPT: ReadonlyMap<string, string> = new Map([
  ['/api/auth/logout', 'ends the session - the way out must always be open'],
  ['/api/auth/handoff', 'the redemption itself, which replaces the session it finds'],
  [
    '/api/change-user',
    'impersonation of the session it is called on, judged on its REAL account (an admin); the writes made while impersonating are guarded like any other',
  ],
  ['/api/users/me/locale', "the display language, a preference of this browser's reader"],
  ['/api/download', 'a read: mints a download token for photos the session may already see'],
]);

/** The status of the refusal; the page sends the user through MiConnect on it (`#lib/step-up.ts`). */
export const STEP_UP_STATUS = 403;

/** Whether this request must be refused until the user signs in through MiConnect. */
export function stepUpRequired(method: string, pathname: string, viaHandoff: boolean): boolean {
  if (!viaHandoff) {
    return false;
  }
  if (!STATE_CHANGING.has(method.toUpperCase())) {
    return false;
  }
  return !STEP_UP_EXEMPT.has(pathname);
}

/** The refusal itself. */
export function stepUpResponse(): Response {
  return new Response(JSON.stringify({ code: STEP_UP_CODE }), {
    status: STEP_UP_STATUS,
    headers: { 'content-type': 'application/json', [STEP_UP_HEADER]: '1' },
  });
}
