import { ensureError } from '$lib/ts-utils';

const BATCH_SIZE = 200;

/**
 * Prepare a one-time download token on the server, then trigger a native
 * browser download via a temporary <a> click.
 *
 * The browser makes a GET request directly to /api/download/{token}, which
 * streams the archive from Immich without any JS buffering or service-worker
 * relay — no RAM limit, no SW lifetime issues, no 750 MB cutoff.
 */
async function fetchAndSave(
	assetIds: string[],
	filename: string,
	opts?: { signal?: AbortSignal }
): Promise<void> {
	const res = await fetch('/api/download', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ assetIds, filename }),
		signal: opts?.signal
	});

	if (!res.ok) {
		const text = await res.text().catch(() => '');
		throw new Error(
			`Échec de la préparation du téléchargement : ${res.status} - ${text.slice(0, 200)}`
		);
	}

	const { token } = (await res.json()) as { token: string };

	const a = document.createElement('a');
	a.href = `/api/download/${token}`;
	a.download = `${filename}.zip`;
	document.body.appendChild(a);
	a.click();
	a.remove();
}

/**
 * Download all assets split into ZIP batches of BATCH_SIZE.
 *
 * - 1 batch  → `album.zip`
 * - N batches → `album-1.zip`, `album-2.zip`, …
 *
 * Progress jumps by 1/N as each batch token is obtained and the download
 * is handed off to the browser's native download manager.
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

	try {
		console.debug(
			`[Download] ${assetIds.length} assets → ${batches.length} batch(es) of ≤${batchSize}`
		);

		for (let i = 0; i < batches.length; i++) {
			if (opts?.signal?.aborted) {
				throw new DOMException('Aborted', 'AbortError');
			}

			const filename = multi ? `${albumName}-${i + 1}` : albumName;
			opts?.onProgress?.(i / batches.length, i, batches.length);

			await fetchAndSave(batches[i], filename, { signal: opts?.signal });

			// Progress advances as soon as the token is obtained and download is initiated
			opts?.onProgress?.((i + 1) / batches.length, i, batches.length);

			if (i < batches.length - 1) {
				// Small pause so the browser's download manager can handle each file
				await new Promise((r) => setTimeout(r, 300));
			}
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
	setTimeout(() => URL.revokeObjectURL(url), 2000);
}
