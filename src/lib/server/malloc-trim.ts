/**
 * Periodically return glibc free memory to the OS.
 *
 * Streaming-heavy Node/Bun services (this proxy serves a lot of thumbnails,
 * images and JSON) allocate and free many native buffers. Under glibc these
 * freed chunks are kept in per-arena free lists rather than returned to the OS,
 * so RSS ratchets up and never comes back down ("freed != returned"). MALLOC_ARENA_MAX
 * caps the number of arenas but does not force the release. malloc_trim(0) does.
 *
 * No-op off Linux (macOS/Windows use different allocators) and off Bun (needs FFI).
 */
let started = false;

export async function startMallocTrim(intervalMs = 45_000): Promise<void> {
	if (started) {
		return;
	}
	if (process.platform !== 'linux') {
		return;
	}
	started = true;

	try {
		// Computed module id so neither tsc nor Vite tries to resolve/bundle the
		// Bun-only builtin; it is loaded at runtime under Bun.
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const ffi: any = await import(/* @vite-ignore */ 'bun' + ':ffi');
		const { dlopen, FFIType } = ffi;
		const libc = dlopen('libc.so.6', {
			malloc_trim: { args: [FFIType.i32], returns: FFIType.i32 }
		});
		const mallocTrim = libc.symbols.malloc_trim as (pad: number) => number;

		const timer = setInterval(() => {
			try {
				const before = process.memoryUsage().rss;
				mallocTrim(0);
				const after = process.memoryUsage().rss;
				const releasedMb = Math.round((before - after) / 1048576);
				if (releasedMb >= 50) {
					console.info(
						`[malloc-trim] released ${releasedMb}MB to OS (rss ${Math.round(after / 1048576)}MB)`
					);
				}
			} catch {
				/* ignore individual trim failures */
			}
		}, intervalMs);
		timer.unref?.();
		console.info('[malloc-trim] periodic glibc trim enabled');
	} catch (e) {
		console.warn('[malloc-trim] unavailable, skipping:', e instanceof Error ? e.message : e);
	}
}
