/**
 * Stand-in for SvelteKit's `$app/env` under vitest: a test is neither the browser, the dev server
 * nor a build. Lets a module that reads one of these flags (`#lib/session.ts`) be imported at all -
 * `tests/step-up.test.ts` loads every route module to read what it exports.
 */
export const browser = false;
export const dev = false;
export const building = false;
