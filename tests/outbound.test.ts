import { describe, it, expect, vi, afterEach } from 'vitest';
import { OUTBOUND_BUDGET_MS, fetchWithAnswerDeadline } from '../src/lib/server/outbound';

/**
 * The property under test is the one that separates this helper from `AbortSignal.timeout()`:
 * the budget bounds the ANSWER and then stops, so a large download is not a stall.
 *
 * Getting that wrong fails in the worst possible way - not on a broken upstream, which is what the
 * deadline is for, but on a HEALTHY one serving a big album archive to somebody on a train. So the
 * test that matters is the second one, which asserts the signal is NOT aborted once the headers
 * are in and the budget has passed.
 */

afterEach(() => {
	vi.unstubAllGlobals();
});

/** Capture the signal the helper hands to `fetch`, and control when the answer arrives. */
function stubFetch(answer: (signal: AbortSignal) => Promise<Response>): { signal(): AbortSignal } {
	let captured: AbortSignal | undefined;
	vi.stubGlobal('fetch', (_input: unknown, init: RequestInit) => {
		captured = init.signal as AbortSignal;
		return answer(captured);
	});
	return {
		signal() {
			if (!captured) {
				throw new Error('fetch was never called');
			}
			return captured;
		}
	};
}

/** A `fetch` that never answers, and rejects the way the platform does when the signal fires. */
const neverAnswers = (signal: AbortSignal) =>
	new Promise<Response>((_resolve, reject) => {
		signal.addEventListener('abort', () => reject(new Error('aborted')));
	});

describe('fetchWithAnswerDeadline', () => {
	it('gives up on an upstream that accepts the connection and then says nothing', async () => {
		stubFetch(neverAnswers);
		await expect(
			fetchWithAnswerDeadline('https://immich.invalid/api/albums', {}, 20)
		).rejects.toThrow('aborted');
	});

	it('lets the body stream long past the budget, because a download is not a stall', async () => {
		const stub = stubFetch(async () => new Response('headers are in'));
		await fetchWithAnswerDeadline('https://immich.invalid/api/download/archive', {}, 20);

		await new Promise((resolve) => setTimeout(resolve, 60));

		// The timer was cleared when the answer arrived. Were it still armed, every archive download
		// longer than the budget would be cut off mid-transfer.
		expect(stub.signal().aborted).toBe(false);
	});

	it("still honours the caller's own signal", async () => {
		const caller = new AbortController();
		stubFetch(neverAnswers);
		const pending = fetchWithAnswerDeadline('https://immich.invalid/api/albums', {
			signal: caller.signal
		});
		caller.abort();
		await expect(pending).rejects.toThrow('aborted');
	});

	it('states the same budget as the rest of the ecosystem', () => {
		// Sky, Portail-etu and Canari's link-preview guard all say 4 s. A budget that differs per
		// project is a budget nobody can state.
		expect(OUTBOUND_BUDGET_MS).toBe(4000);
	});
});
