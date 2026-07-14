import fs from 'node:fs';
import { randomBytes } from 'node:crypto';

/**
 * Race-free disk-cache primitives shared by the on-disk image caches
 * (og-covers, face crops). Every helper avoids the check-then-act (TOCTOU)
 * pattern that CodeQL flags as js/file-system-race: no existsSync guard is
 * ever paired with a later read/write on the same path.
 */

/**
 * Ensure a cache directory exists. Idempotent and race-free: mkdir with
 * recursive:true is a no-op (no throw) when the directory already exists, so
 * there is no check-then-create window between concurrent callers.
 */
export function ensureCacheDir(dir: string): void {
	fs.mkdirSync(dir, { recursive: true });
}

/**
 * Read a cached file, returning null on a cache miss. Attempts the read
 * directly and treats ENOENT as "not cached", instead of an existsSync check
 * followed by a readFileSync that could race with a concurrent unlink.
 */
export function readCacheFile(file: string): Buffer | null {
	try {
		return fs.readFileSync(file);
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
			return null;
		}
		throw e;
	}
}

/**
 * Atomically publish a cache file: write to a unique temp sibling then rename
 * it into place. rename(2) is atomic on the same filesystem, so concurrent
 * readers never observe a half-written file and two concurrent writers cannot
 * corrupt each other's output. The temp file is cleaned up on failure.
 */
export function writeCacheFileAtomic(file: string, data: Buffer): void {
	const tmp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
	try {
		fs.writeFileSync(tmp, data);
		fs.renameSync(tmp, file);
	} catch (e) {
		try {
			fs.unlinkSync(tmp);
		} catch {
			// Temp file may not exist if writeFileSync itself failed; ignore.
		}
		throw e;
	}
}
