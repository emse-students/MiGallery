/**
 * Lightweight production visibility for the memory investigation.
 *
 * The app does no access logging, so when RSS climbs we cannot tell which route
 * drives it or whether the growth is JS heap, live native buffers, or glibc
 * "freed-but-not-returned" memory. This module logs, every `intervalMs`:
 *   - process.memoryUsage() (rss / heapUsed / heapTotal / external / arrayBuffers)
 *   - the busiest request path buckets since the last tick (count + bytes seen)
 *
 * Reading it: if rss climbs while heapUsed/external stay low, the memory is glibc
 * arena retention (malloc_trim reclaims it). If external/arrayBuffers climbs and
 * stays, native buffers are being held. If heapUsed climbs, it is a JS leak.
 */
interface Bucket {
	count: number;
	bytes: number;
}

const buckets = new Map<string, Bucket>();
let started = false;

/** Collapse ids so paths group into stable buckets. */
function bucketize(pathname: string): string {
	return pathname
		.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
		.replace(/\/[0-9]+/g, '/:n');
}

export function recordRequest(pathname: string, bytes = 0): void {
	const key = bucketize(pathname);
	const b = buckets.get(key);
	if (b) {
		b.count++;
		b.bytes += bytes;
	} else {
		buckets.set(key, { count: 1, bytes });
	}
}

const mb = (n: number) => Math.round(n / 1048576);

export function startMemMonitor(intervalMs = 30_000): void {
	if (started) {
		return;
	}
	started = true;

	const timer = setInterval(() => {
		const m = process.memoryUsage();
		const top = [...buckets.entries()]
			.sort((a, b) => b[1].count - a[1].count)
			.slice(0, 8)
			.map(([k, v]) => `${k}=${v.count}${v.bytes ? `/${mb(v.bytes)}MB` : ''}`)
			.join('  ');
		const total = [...buckets.values()].reduce((s, v) => s + v.count, 0);
		buckets.clear();

		console.info(
			`[mem] rss=${mb(m.rss)}MB heapUsed=${mb(m.heapUsed)}MB heapTotal=${mb(m.heapTotal)}MB ` +
				`ext=${mb(m.external)}MB arrayBuffers=${mb(m.arrayBuffers)}MB | reqs=${total} ${top}`
		);
	}, intervalMs);
	timer.unref?.();
	console.info('[mem] monitor enabled');
}
