import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureCacheDir, readCacheFile, writeCacheFileAtomic } from '$lib/server/disk-cache';

/**
 * Unit coverage for the race-free disk-cache primitives that back the on-disk
 * image caches (og-covers, face crops). These replaced an existsSync-then-act
 * pattern (js/file-system-race), so the key guarantees are: a missing file
 * reads as a miss (not a throw), and writes publish atomically.
 */
describe('disk-cache', () => {
	let dir: string;

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'disk-cache-'));
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it('ensureCacheDir creates the directory and is idempotent', () => {
		const target = path.join(dir, 'nested', 'cache');
		ensureCacheDir(target);
		expect(fs.existsSync(target)).toBe(true);
		// Calling again on an existing directory must not throw.
		expect(() => ensureCacheDir(target)).not.toThrow();
	});

	it('readCacheFile returns null on a cache miss instead of throwing', () => {
		expect(readCacheFile(path.join(dir, 'absent.webp'))).toBeNull();
	});

	it('writeCacheFileAtomic + readCacheFile round-trips the bytes', () => {
		const file = path.join(dir, 'entry.bin');
		const data = Buffer.from([0, 1, 2, 253, 254, 255]);
		writeCacheFileAtomic(file, data);
		const read = readCacheFile(file);
		expect(read).not.toBeNull();
		expect(Buffer.compare(read as Buffer, data)).toBe(0);
	});

	it('writeCacheFileAtomic overwrites an existing entry and leaves no temp files', () => {
		const file = path.join(dir, 'entry.bin');
		writeCacheFileAtomic(file, Buffer.from('first'));
		writeCacheFileAtomic(file, Buffer.from('second'));
		expect(readCacheFile(file)?.toString()).toBe('second');
		// The temp sibling must be renamed away, never left behind.
		const leftovers = fs.readdirSync(dir).filter((f) => f.includes('.tmp'));
		expect(leftovers).toEqual([]);
	});
});
