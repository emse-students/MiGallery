# Type checking: why `bun run check` does not use `--tsgo`

`bun run check` runs `svelte-check` on the stock TypeScript 6 language service. It used to pass
`--tsgo` (the native TypeScript 7 backend, about 5 s instead of about 10 s locally). **That flag
is a blind spot, not an optimisation**: `svelte-check --tsgo` checks the script blocks and
`.ts` files but does NOT resolve identifiers inside Svelte TEMPLATE expressions. Measured on
2026-11-01 against `src/routes/mes-photos/+page.svelte` as shipped in v2.18.0 (commit `58746ee`),
whose header read `title={targetUserName ?? photosState.personName}` with `targetUserName`
declared nowhere:

| Tool                                 | Result on that file                                                                      |
| ------------------------------------ | ---------------------------------------------------------------------------------------- |
| `svelte-check --tsgo` (the old gate) | `132 FILES 0 ERRORS` - passes, and production threw a ReferenceError                     |
| `svelte-check` (stock)               | `ERROR "src\routes\mes-photos\+page.svelte" 150:26 "Cannot find name 'targetUserName'."` |

The same switch also surfaced two latent errors the tsgo run could not see
(`$props<{ data: PageData }>()` in `admin/logs` and `admin/users`, a generic `$props` does not
take). They are fixed with the gate.

## The rule

- Template identifiers are only checked by the stock `svelte-check`. Never put `--tsgo` back on
  `check` (or `check:watch`) because it is faster; Svelte does not warn about an undeclared
  template name at compile time either, so no other gate in the pipeline would catch it.
- The cost is about 5 s more per run locally (about 10 s against about 5 s), inside the existing
  `Type check` step of `ci.yml`. No workflow was added.
- `tests/check-script.test.ts` pins the flag's absence.
- To re-prove the gate: `git show 58746ee:src/routes/mes-photos/+page.svelte >
  src/routes/mes-photos/+page.svelte && bun run check` must exit non-zero.
