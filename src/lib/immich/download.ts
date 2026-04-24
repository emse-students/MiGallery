import { ensureError } from '$lib/ts-utils';

const BATCH_SIZE = 200;

// Lazy singleton — only loaded in the browser (streamsaver accesses `document`
// at module-load time, which crashes Node.js during SvelteKit SSR).
let _ss: Awaited<typeof import('streamsaver')>['default'] | null = null;

async function getStreamSaver() {
	if (!_ss) {
		const mod = await import('streamsaver');
		_ss = mod.default;
		_ss.mitm = '/mitm.html';
	}
	return _ss;
}

/**
 * Fetch one archive batch and pipe it directly to disk via StreamSaver.
 * Peak RAM usage is bounded by a single stream chunk (~64 KB), not the
 * total archive size.
 *
 * Falls back to an in-memory Blob if StreamSaver/WritableStream is unavailable
 * (e.g. Safari with blob fallback path or unit-test environments).
 */
async function fetchAndSave(
	assetIds: string[],
	filename: string,
	opts?: {
		onProgress?: (received: number, total: number) => void;
		signal?: AbortSignal;
	}
): Promise<void> {
	const res = await fetch('/api/immich/download/archive', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Accept: '*/*' },
		body: JSON.stringify({ assetIds, ids: assetIds }),
		signal: opts?.signal
	});

	if (!res.ok) {
		const text = await res.text().catch(() => '');
		throw new Error(`Request failed: ${res.status} ${res.statusText} - ${text.slice(0, 200)}`);
	}

	const total = Number(res.headers.get('content-length') || 0);
	let received = 0;

	// StreamSaver path — stream directly to disk, ~0 RAM
	const ss = await getStreamSaver();
	const fileStream = ss.createWriteStream(filename, {
		size: total || undefined
	});

	let body: ReadableStream<Uint8Array> = res.body!;

	if (opts?.onProgress) {
		const progressTransform = new TransformStream<Uint8Array, Uint8Array>({
			transform(chunk, controller) {
				received += chunk.byteLength;
				try {
					opts.onProgress!(received, total);
				} catch {
					// ignore callback errors
				}
				controller.enqueue(chunk);
			}
		});
		body = body.pipeThrough(progressTransform);
	}

	try {
		await body.pipeTo(fileStream, { signal: opts?.signal });
	} catch (e) {
		// StreamSaver's blob fallback (useBlobFallback path, e.g. Safari) already
		// handled the download internally, so a WritableStream close error is expected.
		const err = ensureError(e);
		if (err.name === 'AbortError') {
			throw err;
		}
		// If the writable closed before completion (e.g. user cancelled in browser UI),
		// treat it as abort rather than a hard error.
		console.warn('[Download] pipeTo ended with:', err.message);
	}
}

/**
 * Download all assets split into ZIP batches of BATCH_SIZE.
 *
 * - 1 batch  → `album.zip`
 * - N batches → `album-1.zip`, `album-2.zip`, …
 *
 * Progress reported as an overall 0–1 value across all batches.
 */
export async function downloadInBatches(
	assetIds: string[],
	albumName: string,
	opts?: {
		onProgress?: (overallProgress: number, batchIndex: number, batchCount: number) => void;
		signal?: AbortSignal;
		batchSize?: number;
	}
): Promise<void> {
	if (!Array.isArray(assetIds) || assetIds.length === 0) {
		throw new Error('assetIds must be a non-empty array');
	}

	const batchSize = opts?.batchSize ?? BATCH_SIZE;
	const batches: string[][] = [];
	for (let i = 0; i < assetIds.length; i += batchSize) {
		batches.push(assetIds.slice(i, i + batchSize));
	}

	const multi = batches.length > 1;
	let batchesDone = 0;

	try {
		console.debug(
			`[Download] ${assetIds.length} assets → ${batches.length} batch(es) of ≤${batchSize}`
		);

		for (let i = 0; i < batches.length; i++) {
			if (opts?.signal?.aborted) {
				throw new DOMException('Aborted', 'AbortError');
			}

			const filename = multi ? `${albumName}-${i + 1}.zip` : `${albumName}.zip`;
			console.debug(`[Download] Batch ${i + 1}/${batches.length}: ${filename}`);

			await fetchAndSave(batches[i], filename, {
				onProgress: (recv, total) => {
					if (!opts?.onProgress) {
						return;
					}
					const batchProgress = total > 0 ? recv / total : -1;
					const overall = batchProgress >= 0 ? (batchesDone + batchProgress) / batches.length : -1;
					opts.onProgress(overall, i, batches.length);
				},
				signal: opts?.signal
			});

			batchesDone++;
			opts?.onProgress?.(batchesDone / batches.length, i, batches.length);
		}

		opts?.onProgress?.(1, batches.length - 1, batches.length);
	} catch (e) {
		console.error('[Download] Error:', e);
		throw ensureError(e);
	}
}

export function saveBlobAs(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => {
		URL.revokeObjectURL(url);
	}, 2000);
}
