/**
 * Memory non-regression - runtime chunked-upload behavior (WP-4.4).
 *
 * Exercises the real chunked-upload contract of the Immich proxy over HTTP:
 * intermediate chunks are appended to a .part file on disk and answered BEFORE
 * Immich is ever contacted (see handleChunkedUpload: it returns early while
 * chunkIndex < totalChunks - 1). That lets us verify the memory-safe machinery
 * (per-chunk disk buffering, resume via chunk-status, per-chunk sha256, id
 * validation) without a real Immich and without ever sending the final chunk.
 *
 * The handler still bails with 500 "IMMICH_BASE_URL not set" before the chunk
 * branch when Immich is unconfigured (the CI case: empty IMMICH_BASE_URL), so
 * every runtime assertion is guarded by an `immichConfigured` probe and skips
 * cleanly there. The always-on protection lives in memory-invariants.test.ts.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { setupTestAuth, teardownTestAuth, globalTestContext } from './test-helpers';

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';
const CHUNK_ENDPOINT = `${API_BASE_URL}/api/immich/assets`;
const CHUNK_DIR = join(process.cwd(), 'data', 'chunk-uploads');

let immichConfigured = false;
const createdFileIds: string[] = [];

function uploadKey(): string {
	// write scope covers uploads; it also carries read for chunk-status.
	return globalTestContext.writeApiKey || globalTestContext.adminApiKey || '';
}

function newFileId(suffix: string): string {
	const id = `mem-test-${Date.now()}-${suffix}`;
	createdFileIds.push(id);
	return id;
}

async function chunkStatus(fileId: string): Promise<Response> {
	return fetch(`${CHUNK_ENDPOINT}?chunk-status`, {
		headers: { 'x-api-key': uploadKey(), 'x-file-id': fileId },
		signal: AbortSignal.timeout(10000)
	});
}

async function sendChunk(
	fileId: string,
	index: number,
	total: number,
	body: Uint8Array,
	extraHeaders: Record<string, string> = {}
): Promise<Response> {
	// Copy into a fresh ArrayBuffer: a clean BodyInit regardless of the source
	// Uint8Array's backing-buffer type, while callers keep the Uint8Array for sha256.
	const ab = new ArrayBuffer(body.byteLength);
	new Uint8Array(ab).set(body);
	return fetch(CHUNK_ENDPOINT, {
		method: 'POST',
		headers: {
			'x-api-key': uploadKey(),
			'x-file-id': fileId,
			'x-chunk-index': String(index),
			'x-chunk-total': String(total),
			'content-type': 'application/octet-stream',
			...extraHeaders
		},
		body: ab,
		signal: AbortSignal.timeout(10000)
	});
}

beforeAll(async () => {
	await setupTestAuth();

	// Probe: chunk-status returns 200 when Immich is configured, or 500
	// (IMMICH_BASE_URL not set) in CI. Anything else -> treat as unavailable.
	try {
		const probe = await chunkStatus(`mem-probe-${Date.now()}`);
		immichConfigured = probe.status === 200;
	} catch {
		immichConfigured = false;
	}
});

afterAll(async () => {
	// Best-effort: remove any .part/.complete/.lock left by intermediate chunks.
	// Only relevant locally; in CI the tests skip before creating files.
	for (const fileId of createdFileIds) {
		for (const ext of ['.part', '.part.complete', '.part.lock']) {
			const p = join(CHUNK_DIR, `immich_proxy_${fileId}${ext}`);
			try {
				if (existsSync(p)) {
					unlinkSync(p);
				}
			} catch {
				/* ignore cleanup errors */
			}
		}
	}

	if (globalTestContext.adminApiKey) {
		await teardownTestAuth(globalTestContext as import('./test-helpers').TestContext);
	}
});

describe('Chunked upload - disk buffering and resume', () => {
	it('reports zero received bytes for an unknown file id', async () => {
		if (!immichConfigured) {
			return;
		}

		const res = await chunkStatus(newFileId('unknown'));
		expect(res.status).toBe(200);
		const data = (await res.json()) as { exists: boolean; receivedBytes: number };
		expect(data.exists).toBe(false);
		expect(data.receivedBytes).toBe(0);
	});

	it('appends intermediate chunks to disk without contacting Immich', async () => {
		if (!immichConfigured) {
			return;
		}

		const fileId = newFileId('append');
		const chunk0 = new Uint8Array(1024).fill(1);
		const chunk1 = new Uint8Array(2048).fill(2);

		// Chunk 0 of 3: buffered to the .part file, answered before Immich.
		const r0 = await sendChunk(fileId, 0, 3, chunk0);
		expect(r0.status).toBe(200);
		const d0 = (await r0.json()) as { status: string; index: number };
		expect(d0.status).toBe('chunk_received');
		expect(d0.index).toBe(0);

		let status = (await (await chunkStatus(fileId)).json()) as { receivedBytes: number };
		expect(status.receivedBytes).toBe(chunk0.length);

		// Chunk 1 of 3: appended, so the on-disk size is the running total.
		const r1 = await sendChunk(fileId, 1, 3, chunk1);
		expect(r1.status).toBe(200);
		const d1 = (await r1.json()) as { index: number };
		expect(d1.index).toBe(1);

		status = (await (await chunkStatus(fileId)).json()) as { receivedBytes: number };
		expect(status.receivedBytes).toBe(chunk0.length + chunk1.length);
		// The final chunk (which would submit to Immich) is intentionally never sent.
	});

	it('accepts a chunk whose x-chunk-sha256 matches', async () => {
		if (!immichConfigured) {
			return;
		}

		const fileId = newFileId('goodsha');
		const chunk = new Uint8Array(512).fill(7);
		const sha = createHash('sha256').update(chunk).digest('hex');

		const res = await sendChunk(fileId, 0, 2, chunk, { 'x-chunk-sha256': sha });
		expect(res.status).toBe(200);
	});

	it('rejects a chunk whose x-chunk-sha256 does not match (400)', async () => {
		if (!immichConfigured) {
			return;
		}

		const fileId = newFileId('badsha');
		const chunk = new Uint8Array(512).fill(9);
		// A hash that cannot match the payload.
		const res = await sendChunk(fileId, 0, 2, chunk, { 'x-chunk-sha256': '0'.repeat(64) });
		expect(res.status).toBe(400);
	});

	it('rejects an invalid x-file-id (400)', async () => {
		if (!immichConfigured) {
			return;
		}

		// Not tracked for cleanup: an invalid id never yields an on-disk file.
		const res = await sendChunk('bad id/with slash', 0, 1, new Uint8Array(8).fill(1));
		expect(res.status).toBe(400);
	});
});
