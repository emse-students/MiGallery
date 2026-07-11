/**
 * Global Sharp / libvips configuration (server only).
 *
 * Sharp relies on libvips (native memory, counted under `external`).
 * By default libvips keeps an operations cache and spawns as many threads as
 * CPU cores - freed native memory is moreover not returned to the OS under
 * glibc (arena fragmentation). On a proxy that generates many thumbnails,
 * this makes RSS climb and then plateau.
 *
 * This module is imported once (idempotent) everywhere Sharp is used,
 * to apply conservative settings:
 *  - `cache(false)`   : no native retention between requests;
 *  - `concurrency(2)` : bounds threads/pools per operation.
 *
 * To be complemented on the deployment side with `MALLOC_ARENA_MAX=2` to limit
 * glibc fragmentation of libvips allocations.
 */
import sharp from 'sharp';

// An ES module is evaluated only once: these settings apply a single
// time on first import, regardless of how many files import it.
sharp.cache(false);
sharp.concurrency(2);

export default sharp;
