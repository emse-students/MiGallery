/**
 * The step-up, as the BROWSER sees it (the server half is `#lib/server/step-up.ts`): a session a
 * Canari sign-in handoff opened is refused any change with `403` and the header below, and the page
 * then sends the user through the ordinary MiConnect sign-in, back to where they were. After it,
 * the session is an ordinary one and the action works.
 */
import { loginUrlWithRedirect } from '#lib/auth-redirect.ts';

/** The refusal's code, in its JSON body. */
export const STEP_UP_CODE = 'STEP_UP_REQUIRED';
/** Set on the refusal so the client recognises it without reading (and consuming) the body. */
export const STEP_UP_HEADER = 'x-step-up-required';

/** Whether a response is the step-up refusal. */
export function isStepUpRefusal(res: Response): boolean {
  return res.status === 403 && res.headers.get(STEP_UP_HEADER) === '1';
}

/**
 * Wraps `fetch` once, at boot (`hooks.client.ts`): a step-up refusal sends the page to MiConnect's
 * sign-in with the current page as its destination. The response is still returned, so the caller's
 * own error path runs as it would for any 403 while the navigation happens.
 */
export function installStepUpRedirect(win: Window & typeof globalThis = window): void {
  const original = win.fetch.bind(win);
  const guarded = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const res = await original(input, init);
    if (isStepUpRefusal(res)) {
      console.warn('[step-up] a handoff session needs a MiConnect sign-in for this action');
      win.location.assign(loginUrlWithRedirect(win.location.pathname + win.location.search));
    }
    return res;
  };
  // Keep the static members (`preconnect`) the platform's fetch carries.
  win.fetch = Object.assign(guarded, original) as typeof fetch;
}
