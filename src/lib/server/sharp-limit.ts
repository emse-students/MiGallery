// Global limiter shared by every endpoint that runs Sharp on an Immich image
// (album covers, face crops, ...). A SINGLE semaphore across all of them bounds
// total native memory: at most MAX_CONCURRENT_SHARP images are decoded at once,
// no matter how many endpoints are hit concurrently. Each caller must acquire
// the slot BEFORE downloading its source so in-flight fetch buffers are bounded
// too. When the wait queue is full, acquireSharp resolves to null and the caller
// should degrade gracefully (e.g. redirect to a proxied thumbnail) rather than
// risk an OOM under burst.
const MAX_CONCURRENT_SHARP = 4;
const MAX_QUEUE_SIZE = 12;

let runningSharp = 0;
const sharpQueue: Array<() => void> = [];

/**
 * Acquire a Sharp processing slot. Resolves with a release() callback, or with
 * null if the queue is already saturated (MAX_QUEUE_SIZE). Always call release()
 * in a finally block once processing is done.
 */
export function acquireSharp(): Promise<(() => void) | null> {
	if (sharpQueue.length >= MAX_QUEUE_SIZE) {
		return Promise.resolve(null);
	}
	return new Promise((resolve) => {
		const tryAcquire = () => {
			if (runningSharp < MAX_CONCURRENT_SHARP) {
				runningSharp++;
				resolve(() => {
					runningSharp--;
					const next = sharpQueue.shift();
					if (next) {
						next();
					}
				});
			} else {
				sharpQueue.push(tryAcquire);
			}
		};
		tryAcquire();
	});
}
