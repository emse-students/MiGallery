/**
 * HOMONYMS ARE NEVER SHOWN BARE (Canari's docs/wiki/profiles-and-access.md, D56 - one rule across
 * the ecosystem). A row whose folded name another SHOWN row shares carries a distinguishing detail:
 * the promo, then the formation, then the first 8 characters of `id_user` (an admin page may show
 * an opaque id; a picker may not). The admin list "Utilisateurs & roles" already shows every
 * row's promo and formation, so what this adds is the last step: the id prefix of each row that
 * shares its name, promo AND formation with another shown row - the case of an Alumni duplicate
 * beside the real account, which nothing else told apart (`users` has no creation date).
 */
import { normalizeText } from '#lib/fuzzy.ts';

/** The characters of `id_user` a homonym row shows. */
export const HOMONYM_ID_PREFIX_LENGTH = 8;

/** The fields of a row the rule reads. */
export interface HomonymRow {
  id_user: string;
  name?: string | null;
  promo?: number | null;
  formation?: string | null;
}

/** A name as the rule compares it: case, accents and runs of white space folded. */
function foldName(name: string | null | undefined): string {
  return normalizeText(name).replace(/\s+/g, ' ');
}

/**
 * For the rows SHOWN, the id prefix each row must carry: present only for a row whose folded name,
 * promo and formation another shown row shares. Rows with no name are never grouped.
 */
export function homonymIdHints(rows: readonly HomonymRow[]): Map<string, string> {
  const groups = new Map<string, string[]>();
  for (const row of rows) {
    const name = foldName(row.name);
    if (!name) {
      continue;
    }
    const key = JSON.stringify([name, row.promo ?? null, normalizeText(row.formation)]);
    const ids = groups.get(key) ?? [];
    ids.push(row.id_user);
    groups.set(key, ids);
  }
  const hints = new Map<string, string>();
  for (const ids of groups.values()) {
    if (ids.length < 2) {
      continue;
    }
    for (const id of ids) {
      hints.set(id, id.slice(0, HOMONYM_ID_PREFIX_LENGTH));
    }
  }
  return hints;
}
