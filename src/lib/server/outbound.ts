/**
 * THE ONE DEADLINE EVERY OUTBOUND CALL FROM THIS SERVER ANSWERS TO.
 *
 * Every page here is a proxy: nothing this server renders exists locally, so every request in
 * flight is waiting on Immich. Not one of the thirty-odd server-to-server calls carried a deadline
 * of its own - so an Immich that accepted the connection and then said nothing held the request
 * behind it for as long as it cared to, and nothing recovers from that: there is no error to catch
 * and no fallback to reach, only a page that never finishes.
 *
 * `fetch` has no timeout of its own. Node 24 gives undici's `headersTimeout` of 300 s, so the true
 * worst case today is five minutes rather than forever - long enough that the browser, the reverse
 * proxy and the reader have all given up first, which is the same outcome.
 *
 * 4 s is the number the rest of the ecosystem states (Sky's `OUTBOUND_BUDGET_MS`, Portail-etu's,
 * Canari's link-preview guard). One number rather than thirty, because a budget that differs per
 * call site is a budget nobody can state.
 */
export const OUTBOUND_BUDGET_MS = 4000;

/**
 * The budget applies to the ANSWER, not to the transfer.
 *
 * Most calls here fetch a small JSON document, and for those `AbortSignal.timeout()` at the call
 * site is the whole story: it bounds headers and body together, which is what you want when the
 * body is two kilobytes of album metadata.
 *
 * A handful of routes are different - `asset-original`, the thumbnail proxies, the archive
 * download, the catch-all `/api/immich` proxy. They hand Immich's response body straight to the
 * reader, and that body can be an album archive of several gigabytes over a phone connection.
 * Aborting THAT at 4 s would not fix a stall, it would break every large download - so those use
 * this helper, which stops the clock the moment the response headers arrive and lets the body
 * stream for as long as it keeps moving.
 *
 * Undici still bounds a body that goes silent mid-stream (`bodyTimeout`, 300 s of INACTIVITY, not
 * of duration), so a stalled transfer is not unbounded either. It is simply a different failure
 * from the one this budget is written for, with a different right answer.
 *
 * A timeout surfaces as a THROW (`AbortError`), never as a status, so the catch around the call is
 * what has to say the upstream was unreachable.
 *
 * @param input - the request, exactly as `fetch` takes it
 * @param init - the request options, exactly as `fetch` takes them
 * @param budgetMs - the answer budget; defaults to the ecosystem's 4 s
 * @returns the response, with its body still streaming
 */
export async function fetchWithAnswerDeadline(
	input: Parameters<typeof fetch>[0],
	init: RequestInit = {},
	budgetMs: number = OUTBOUND_BUDGET_MS
): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), budgetMs);
	// A caller's own signal is composed with the budget, never replaced by it: dropping it would
	// silently un-cancel a request the caller asked to be able to cancel.
	const signal = init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal;
	try {
		return await fetch(input, { ...init, signal });
	} finally {
		// Clearing the timer is what makes this "answer only": once the headers are in, nothing is
		// left to fire, so the body streams on the connection's own terms.
		clearTimeout(timer);
	}
}
