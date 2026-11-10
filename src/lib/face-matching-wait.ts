/**
 * The wait after a selfie, on "Mes photos" (owner, 2026-11-10), pure so it is tested on its own.
 *
 * The server queues a background re-match when a member enrols; `GET /api/users/me/face/enrolment`
 * says whether one is still queued or running (`matching`). The wait ENDS on the server's
 * `matching: false`, never on a clock: the poll interval only paces how often the display asks.
 */

/** What the status route answers (the member's own counts). */
export interface EnrolmentStatus {
  matching: boolean;
  /** Visible photos of the member. */
  photos: number;
  /** Faces waiting for their answer. */
  toConfirm: number;
}

/** What the panel shows. */
export type WaitOutcome = 'waiting' | 'to_check' | 'found' | 'none';

/** The panel's state for one status answer. */
export function waitOutcome(status: EnrolmentStatus): WaitOutcome {
  if (status.matching) return 'waiting';
  if (status.toConfirm > 0) return 'to_check';
  if (status.photos > 0) return 'found';
  return 'none';
}

/** Whether `value` has the shape of the status route's answer (a wrong shape is not "done"). */
export function isEnrolmentStatus(value: unknown): value is EnrolmentStatus {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.matching === 'boolean' &&
    typeof v.photos === 'number' &&
    typeof v.toConfirm === 'number'
  );
}

/** First delay between two asks, and the cap the backoff doubles up to (ms). */
export const POLL_FIRST_MS = 2000;
export const POLL_CAP_MS = 30000;

/**
 * What an HTTP status means for the wait. A status code is an ANSWER: 401/403 (signed out, not
 * allowed) and 503 (the face store is off) will not change by asking again, so the wait stops with
 * a message. Any other failure is retried: only the server's `matching: false` ends the wait.
 */
export function statusVerdict(status: number): 'stop' | 'retry' {
  return status === 401 || status === 403 || status === 503 ? 'stop' : 'retry';
}

/** The delay after a failed read: the previous one doubled, up to the cap. */
export function backoffDelay(previous: number): number {
  return Math.min(POLL_CAP_MS, Math.max(POLL_FIRST_MS, previous * 2));
}
