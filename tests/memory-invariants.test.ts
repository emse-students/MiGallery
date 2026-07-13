/**
 * Memory non-regression guards (WP-4.4).
 *
 * These tests read the Immich proxy handler source and assert the memory-safe
 * upload invariants that the whole OOM saga (Bun -> Node migration, streaming
 * to disk) established. They are pure source assertions: no running server and
 * no Immich are required, so they run in every environment (incl. CI where
 * IMMICH_BASE_URL is empty) and fail fast if a refactor reintroduces buffering.
 *
 * The runtime counterpart (real chunk endpoint behavior over HTTP) lives in
 * memory-upload.test.ts and gracefully skips when Immich is not configured.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PROXY_HANDLER = join(
	process.cwd(),
	'src',
	'routes',
	'api',
	'immich',
	'[...path]',
	'+server.ts'
);

const source = readFileSync(PROXY_HANDLER, 'utf-8');

describe('Memory invariants - Immich proxy upload path', () => {
	it('never allocates a raw buffer of arbitrary size (no Buffer.alloc)', () => {
		// Buffer.alloc(n) is the classic way to reintroduce a RAM blow-up on a
		// large upload. CLAUDE.md bans it outright on the upload path.
		expect(source).not.toMatch(/Buffer\.alloc\b/);
	});

	it('never reads a whole upload file into RAM (no readFileSync / promises.readFile)', () => {
		// Hashing or forwarding the assembled file must stay streamed. A
		// readFileSync/readFile of the .part / .complete file would buffer the
		// entire (potentially GB-sized) upload.
		expect(source).not.toMatch(/readFileSync\b/);
		expect(source).not.toMatch(/fs\.promises\.readFile\b/);
	});

	it('appends each chunk to disk instead of accumulating the file in memory', () => {
		// Chunk 0 truncates (flag 'w'), subsequent chunks append (flag 'a'):
		// only one bounded chunk is ever held in RAM at a time.
		expect(source).toMatch(/flag:\s*chunkIndex\s*===\s*0\s*\?\s*['"]w['"]\s*:\s*['"]a['"]/);
	});

	it('computes the full-file sha256 from a read stream, not a buffered read', () => {
		expect(source).toMatch(/createReadStream\(\s*tempFilePath\s*\)/);
		expect(source).toMatch(/hash\.update\(/);
	});

	it('streams the assembled file to Immich via createReadStream in the form data', () => {
		expect(source).toMatch(/formData\.append\(\s*['"]assetData['"]\s*,\s*fs\.createReadStream\(/);
	});

	it('forwards non-upload request bodies as a stream (duplex half), never buffered', () => {
		expect(source).toMatch(/bodyToForward\s*=\s*request\.body/);
		expect(source).toMatch(/duplex:\s*['"]half['"]/);
	});

	it('buffers request.arrayBuffer() only on the two bounded paths (chunk <=5MB, simple <10MB)', () => {
		// The only legitimate full-body reads are the per-chunk buffer and the
		// size-capped simple upload. A third occurrence signals a new unbounded
		// path buffering an entire request body.
		const occurrences = (source.match(/request\.arrayBuffer\(\)/g) || []).length;
		expect(occurrences).toBeLessThanOrEqual(2);
	});
});
