import * as variables from '$app/env/private';

/**
 * The declared server variables (`src/env.ts`) as one plain object.
 *
 * It is a COPY, on purpose: kit 3's `$app/env/private` is a read-only module namespace, and the
 * test suite sets `IMMICH_BASE_URL` per test and replaces this whole module with `vi.mock`. Every
 * server module reads configuration through here rather than from the kit module, so one path
 * decides where the values come from.
 */
export const env: Record<string, string | undefined> = { ...variables };
