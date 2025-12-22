import { ensureError } from '$lib/ts-utils';

export async function fetchArchive(
	assetIds: string[],
	opts?: { filename?: string; onProgress?: (progress: number) => void; signal?: AbortSignal }
): Promise<Blob> {
	if (!Array.isArray(assetIds) || assetIds.length === 0) {
		throw new Error('assetIds must be a non-empty array');
	}

	// Use the standard endpoint that works with the proxy
	const url = '/api/immich/download/archive';

	// Send both formats for compatibility
	const body = JSON.stringify({ assetIds, ids: assetIds });

	try {
		console.debug(`[Download] Requesting archive from ${url}`);
		const res = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Accept: '*/*' },
			body,
			signal: opts?.signal
		});

		if (!res.ok) {
			const text = await res.text().catch(() => '');
			throw new Error(`Request failed: ${res.status} ${res.statusText} - ${text.slice(0, 200)}`);
		}

		const contentType = res.headers.get('content-type') || '';
		const contentLengthHeader = res.headers.get('content-length');
		const total = contentLengthHeader ? Number(contentLengthHeader) : 0;

		// If we have a body and progress callback, read stream
		if (res.body && opts?.onProgress) {
			const reader = res.body.getReader();
			const chunks: Uint8Array[] = [];
			let received = 0;

			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					break;
				}

				if (value) {
					chunks.push(value);
					received += value.byteLength;
					try {
						opts.onProgress(total ? Math.min(1, received / total) : -1);
					} catch {
						// ignore callback errors
					}
				}
			}

			try {
				opts.onProgress(1);
			} catch {
				// ignore
			}

			const merged = new Uint8Array(received);
			let offset = 0;
			for (const chunk of chunks) {
				merged.set(chunk, offset);
				offset += chunk.byteLength;
			}

			return new Blob([merged], { type: contentType });
		}

		// Fallback for no progress or no stream support
		return await res.blob();
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
