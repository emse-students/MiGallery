/**
 * Minimal ambient declaration for `bun:sqlite`, the database driver this application runs on.
 *
 * Deliberately NOT `@types/bun`: that package augments the global scope (Bun's `fetch`, `Response`,
 * timers and more) and would silently redefine types SvelteKit and `@types/node` already provide.
 * What is needed here is one module, so one module is declared - and declaring only the surface
 * actually used means TypeScript rejects a call this codebase has never proven works.
 *
 * The two departures from better-sqlite3, both measured and both able to corrupt data silently,
 * are encoded in the types rather than left to memory:
 *
 *  - `get()` returns `null` when no row matches, NOT `undefined`.
 *  - `close()` is LAZY. With prepared statements outstanding it returns having left the file open;
 *    `close(true)` closes immediately. See `src/lib/db/database.ts`.
 *
 * A third has no type to express it: an object bind must carry the placeholder's sigil in its keys
 * (`{ '@id': x }`, not `{ id: x }`), and a bare key binds NOTHING while reporting success. That one
 * is enforced at runtime by the guard in `src/lib/db/database.ts`.
 */
declare module 'bun:sqlite' {
  export interface Statement {
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): { changes: number; lastInsertRowid: number };
    finalize(): void;
  }

  export class Database {
    constructor(
      path: string,
      options?: { readonly?: boolean; readwrite?: boolean; create?: boolean }
    );
    prepare(sql: string): Statement;
    exec(sql: string): void;
    /** Pass `true` to close now instead of when the last statement is collected. */
    close(throwOnError?: boolean): void;
  }
}
