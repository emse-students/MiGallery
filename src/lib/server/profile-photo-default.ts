/**
 * A DEFAULT profile photo for a member who has no valid one (owner, 2026-11-01,
 * docs/wiki/face-matching-option-c.md, "The default profile photo").
 *
 * WHY. Before lot A6 a member who never picked a photo still had an avatar: the route fell back to
 * Immich's thumbnail of their person, the face Immich FEATURED for it. A6 removed every person
 * call, so every member who never chose shows initials. This puts a real photo back, from the
 * member's own matches only.
 *
 * WHAT IS VALID. A profile photo is valid while it is a VISIBLE match of the member's
 * (`profileFace`) AND Immich still has the asset. A CHOSEN photo is replaced only when its photo
 * is KNOWN to be gone: in the one-off run, absent from `present` (every asset Immich's own table
 * still holds, locked included); elsewhere, only when a direct read says `trashed`
 * (`assetPresence`: Immich answers one 400 for deleted, unseen and LOCKED, so a 400 is unknown
 * and the choice is kept). Otherwise - none set, the
 * asset gone, the face rejected or given to someone else - a default is chosen:
 * 1. the face Immich FEATURED for their old person, when the caller hands it in (the one-off run,
 *    from Immich's own table), Immich still has the photo, AND that exact face is already one of
 *    THIS member's visible matches: the photo they had before A6;
 * 2. else the best of their visible matches by `compareProfileCandidates`.
 *
 * NEVER A CLAIM (lead, 2026-11-01). This runs unattended: it never writes `confirmed`, never
 * calls `claimFace`, never moves a face from another member. A featured face that is not a
 * visible match of theirs (another member holds it, or it waits for their answer) is passed over
 * and counted (`featured_not_theirs`); the member gets their best visible match.
 *
 * A CHOICE IS NEVER OVERWRITTEN. `users.photos_asset_source` says `chosen` (the member, or an admin
 * for them, through PUT /api/users/me/profile-photo) or `default`. A valid choice is kept as it
 * is; a valid default may be replaced by a better default; an INVALID choice (the photo is gone)
 * is replaced by a default, recorded as such, since there is nothing left to keep.
 *
 * Immich is read OUTSIDE the engine lock (network), the decision and the write inside it.
 */

import type { DatabaseInstance } from '#lib/db/database.ts';
import { FACE_MODEL, FACE_SELECTION_UNDONE } from '#lib/face-embedding.ts';
import {
  FEATURED_MIN_OVERLAP,
  boxOverlap,
  rankProfileCandidates,
  type Box,
  type ProfileCandidate,
} from '#lib/profile-photo-rank.ts';
import { runExclusive, type FaceEngine } from '#lib/server/face-engine.ts';
import { VISIBLE_MATCH_SQL, profileFace } from '#lib/server/face-photos.ts';
import { assetPresence, searchAssetsByIds } from '#lib/server/immich-search.ts';
import type { FaceKey } from '#lib/server/face-store.ts';
import { createLogger } from '#lib/server/logger.ts';

const log = createLogger('profile-photo-default');

/** How many ranked candidates are checked against Immich (one request): the first alive wins. */
export const CANDIDATES_CHECKED = 25;

/** The face Immich featured for a member's old person: a photo and the face's box in it. */
export interface FeaturedFace extends Box {
  assetId: string;
}

/** What one member's run did, for the aggregate report (never an id). */
export type DefaultOutcome =
  | 'kept_choice'
  | 'kept_default'
  | 'set_featured'
  | 'set_scored'
  | 'none';

/** The member's profile photo pointer and whether it was chosen. */
export function profilePhotoOf(
  db: DatabaseInstance,
  userId: string
): { assetId: string | null; source: 'chosen' | 'default' | null } {
  const row = db
    .prepare('SELECT photos_asset_id, photos_asset_source FROM users WHERE id_user = ?')
    .get(userId) as { photos_asset_id: string | null; photos_asset_source: string | null } | null;
  const assetId = row?.photos_asset_id || null;
  const source = row?.photos_asset_source;
  return {
    assetId,
    source: !assetId ? null : source === 'default' ? 'default' : 'chosen',
  };
}

/** Every visible face of the member with what the ranking reads (no capture date yet). */
export function profileCandidates(engine: FaceEngine, userId: string): ProfileCandidate[] {
  const rows = engine.db
    .prepare(
      `SELECT asset_id, face_index, state, distance FROM face_matches
        WHERE user_id = ? AND model = ? AND ${VISIBLE_MATCH_SQL}`
    )
    .all(userId, FACE_MODEL) as Array<{
    asset_id: string;
    face_index: number;
    state: string;
    distance: number;
  }>;
  const boxOf = engine.faceDb.prepare(
    `SELECT x1, y1, x2, y2, img_w, img_h, score FROM face_embeddings
      WHERE asset_id = ? AND face_index = ? AND model = ?`
  );
  const facesOn = engine.faceDb.prepare(
    'SELECT COUNT(*) AS n FROM face_embeddings WHERE asset_id = ? AND model = ?'
  );
  const out: ProfileCandidate[] = [];
  for (const r of rows) {
    const b = boxOf.get(r.asset_id, r.face_index, FACE_MODEL) as {
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      img_w: number;
      img_h: number;
      score: number | null;
    } | null;
    if (!b) {
      // No box, no crop: the avatar could not be cut from it.
      continue;
    }
    const frame = b.img_w * b.img_h;
    out.push({
      assetId: r.asset_id,
      faceIndex: r.face_index,
      confirmed: r.state === 'confirmed',
      distance: r.distance,
      areaRatio: frame > 0 ? Math.max(0, ((b.x2 - b.x1) * (b.y2 - b.y1)) / frame) : 0,
      score: b.score,
      facesOnPhoto: (facesOn.get(r.asset_id, FACE_MODEL) as { n: number }).n,
      takenAt: null,
    });
  }
  return out;
}

/** The stored face on `featured.assetId` whose box IS the featured one, or null. */
export function featuredFaceKey(faceDb: DatabaseInstance, featured: FeaturedFace): FaceKey | null {
  const rows = faceDb
    .prepare(
      `SELECT face_index, x1, y1, x2, y2, img_w, img_h FROM face_embeddings
        WHERE asset_id = ? AND model = ? ORDER BY face_index`
    )
    .all(featured.assetId, FACE_MODEL) as Array<{
    face_index: number;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    img_w: number;
    img_h: number;
  }>;
  let best: { faceIndex: number; overlap: number } | null = null;
  for (const r of rows) {
    const overlap = boxOverlap(featured, {
      x1: r.x1,
      y1: r.y1,
      x2: r.x2,
      y2: r.y2,
      imgW: r.img_w,
      imgH: r.img_h,
    });
    if (overlap >= FEATURED_MIN_OVERLAP && (!best || overlap > best.overlap)) {
      best = { faceIndex: r.face_index, overlap };
    }
  }
  return best ? { assetId: featured.assetId, faceIndex: best.faceIndex } : null;
}

/** Whether `face` is one of `userId`'s VISIBLE matches (auto, or confirmed by them). */
function visibleMatchOf(db: DatabaseInstance, userId: string, face: FaceKey): boolean {
  return (
    db
      .prepare(
        `SELECT 1 AS x FROM face_matches WHERE asset_id = ? AND face_index = ? AND model = ?
          AND user_id = ? AND ${VISIBLE_MATCH_SQL}`
      )
      .get(face.assetId, face.faceIndex, FACE_MODEL, userId) != null
  );
}

/** The assets Immich still serves among `ids` (not trashed, not deleted), with their capture date. */
async function aliveAssets(
  fetchFn: typeof fetch,
  ids: readonly string[]
): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  const unique = [...new Set(ids)];
  if (unique.length === 0) {
    return out;
  }
  for (const asset of await searchAssetsByIds(fetchFn, unique)) {
    const t = Date.parse(asset.fileCreatedAt ?? asset.localDateTime ?? '');
    out.set(asset.id, Number.isFinite(t) ? t : null);
  }
  return out;
}

/**
 * Give `userId` a default profile photo when they have no valid one (module header). `featured`:
 * the face Immich featured for their old person, when known. `present`: every asset id Immich's
 * table still holds (the one-off run's export), the ONLY evidence that a chosen photo is deleted;
 * without it a choice goes only when its photo is in the trash. `dryRun` decides without writing.
 * `report.featuredNotTheirs` is set when a featured face was passed over because it is not a
 * visible match of theirs. Throws when Immich cannot be read: nothing is written then.
 */
export async function ensureDefaultProfilePhoto(
  engine: FaceEngine,
  userId: string,
  fetchFn: typeof fetch,
  options: {
    featured?: FeaturedFace | null;
    present?: ReadonlySet<string> | null;
    dryRun?: boolean;
    report?: { featuredNotTheirs?: boolean };
    /** Leave a member whose face selection an admin undid alone (checked inside the lock). */
    unlessUndone?: boolean;
  } = {}
): Promise<DefaultOutcome> {
  const { db } = engine;
  const current = profilePhotoOf(db, userId);
  const ranked = rankProfileCandidates(profileCandidates(engine, userId));
  const top = ranked.slice(0, CANDIDATES_CHECKED);
  const featured = options.featured ?? null;
  if (ranked.length === 0 && !featured) {
    // No visible match at all (so no valid photo either): nothing to pick, nothing to ask Immich.
    return 'none';
  }
  const alive = await aliveAssets(fetchFn, [
    ...(current.assetId ? [current.assetId] : []),
    ...(featured ? [featured.assetId] : []),
    ...top.map((c) => c.assetId),
  ]);
  const stillTheirs = !!current.assetId && !!profileFace(db, userId, current.assetId);
  // A choice is kept unless its photo is KNOWN to be gone (module header); a default may go on
  // less (the search's answer).
  const currentValid = stillTheirs && (await currentStillThere());
  if (currentValid && current.source === 'chosen') {
    log.debug('profile photo kept: the member chose it and it is still theirs');
    return 'kept_choice';
  }

  return runExclusive((): DefaultOutcome => {
    if (options.unlessUndone) {
      const undone = db
        .prepare(
          'SELECT 1 FROM face_reference_selection WHERE user_id = ? AND model = ? AND version = ?'
        )
        .get(userId, FACE_MODEL, FACE_SELECTION_UNDONE);
      if (undone) {
        log.debug('default profile photo skipped: the selection was undone');
        return 'none';
      }
    }
    // 1. The face Immich featured for their old person: the photo they had before A6.
    if (featured && alive.has(featured.assetId)) {
      const key = featuredFaceKey(engine.faceDb, featured);
      if (key && visibleMatchOf(db, userId, key)) {
        return write(key.assetId, 'set_featured');
      }
      if (key) {
        // Held by another member, waiting for their answer, or rejected: never claimed here.
        if (options.report) options.report.featuredNotTheirs = true;
        log.info('featured face passed over: it is not a visible match of the member');
      } else {
        log.info('the featured face is not among the faces the store holds on that photo');
      }
    }
    // 2. The best of their visible matches that Immich still serves; ties read the capture date.
    const best = rankProfileCandidates(
      top
        .filter((c) => alive.has(c.assetId))
        .map((c) => ({ ...c, takenAt: alive.get(c.assetId) ?? null }))
    )[0];
    if (best) {
      return write(best.assetId, 'set_scored');
    }
    log.debug('no default profile photo: no visible match Immich still serves');
    return currentValid ? 'kept_default' : 'none';
  });

  /** Whether Immich still has the current photo, as far as the evidence for its source goes. */
  async function currentStillThere(): Promise<boolean> {
    const assetId = current.assetId as string;
    if (current.source !== 'chosen') {
      return alive.has(assetId);
    }
    if (options.present) {
      // The export is a snapshot: a photo chosen after it is absent from it, yet the search may
      // still serve it, and a photo the search finds exists.
      return options.present.has(assetId) || alive.has(assetId);
    }
    if (alive.has(assetId)) {
      return true;
    }
    const presence = await assetPresence(fetchFn, assetId);
    if (presence === 'unknown') {
      log.info('chosen photo kept: Immich does not say it is gone');
    }
    return presence !== 'trashed';
  }

  /** Point the profile photo at `assetId` as a default (unless it already is, or a dry run). */
  function write(assetId: string, outcome: DefaultOutcome): DefaultOutcome {
    // Re-read inside the lock: a choice made while Immich answered is never overwritten.
    const now = profilePhotoOf(db, userId);
    if (now.source === 'chosen' && now.assetId && profileFace(db, userId, now.assetId)) {
      if (now.assetId !== current.assetId || currentValid) {
        return 'kept_choice';
      }
    }
    if (now.assetId === assetId && now.source === 'default') {
      return 'kept_default';
    }
    if (!options.dryRun) {
      db.prepare(
        "UPDATE users SET photos_asset_id = ?, photos_asset_source = 'default' WHERE id_user = ?"
      ).run(assetId, userId);
    }
    return outcome;
  }
}

/** Members a default may concern: any with a reference or a visible match. */
export function enrolledMembers(db: DatabaseInstance): string[] {
  return (
    db
      .prepare(
        `SELECT user_id FROM face_references WHERE model = ?
         UNION SELECT user_id FROM face_matches WHERE model = ? AND ${VISIBLE_MATCH_SQL}
         ORDER BY user_id`
      )
      .all(FACE_MODEL, FACE_MODEL) as Array<{ user_id: string }>
  ).map((r) => r.user_id);
}

/**
 * The Immich person ids a run can use a featured face for: the `photos_id` (lowercase) of every
 * enrolled member that has one. `featuredByPerson` is read for no other key, so this is exactly
 * what the one-off client must send as G lines - the Immich table holds far more persons (about
 * 94k in production) than there are members.
 */
export function wantedPersons(db: DatabaseInstance): string[] {
  const personOf = linkedPersonOf(db);
  const wanted = new Set<string>();
  for (const userId of enrolledMembers(db)) {
    const person = personOf(userId);
    if (person) wanted.add(person);
  }
  return [...wanted].sort();
}

/**
 * A member's Immich person id (their `photos_id`), lowercased as every featured-face key is, or
 * null when they are not linked. The one lookup of the run and of {@link wantedPersons}.
 */
function linkedPersonOf(db: DatabaseInstance): (userId: string) => string | null {
  const stmt = db.prepare('SELECT photos_id FROM users WHERE id_user = ?');
  return (userId) =>
    (stmt.get(userId) as { photos_id: string | null } | null)?.photos_id?.toLowerCase() || null;
}

/** The aggregate of a run: counts only. */
export type DefaultReport = Record<DefaultOutcome | 'failed', number> & {
  members: number;
  featuredGiven: number;
  /** Featured faces passed over because another member held them, or they waited an answer. */
  featuredNotTheirs: number;
  /** Asset ids Immich's table holds, as handed in (0: no export, the live check was used). */
  presentGiven: number;
  chosenGoneReplaced: number;
};

/**
 * Apply {@link ensureDefaultProfilePhoto} to every enrolled member, one after the other.
 * `featuredByPerson` maps an Immich person id (the member's `photos_id`, lowercase) to the face
 * Immich featured for it; a member whose person has none (the group is gone) is ranked from their
 * matches. `present`: every asset id Immich's table still holds (null: not exported, the live
 * check decides). A member's failure is counted and logged; the run goes on. Idempotent: a second
 * run keeps every photo the first one set.
 */
export async function runDefaultProfilePhotos(
  engine: FaceEngine,
  fetchFn: typeof fetch,
  featuredByPerson: ReadonlyMap<string, FeaturedFace>,
  dryRun: boolean,
  present: ReadonlySet<string> | null = null
): Promise<DefaultReport> {
  const report: DefaultReport = {
    members: 0,
    featuredGiven: 0,
    featuredNotTheirs: 0,
    presentGiven: present?.size ?? 0,
    chosenGoneReplaced: 0,
    kept_choice: 0,
    kept_default: 0,
    set_featured: 0,
    set_scored: 0,
    none: 0,
    failed: 0,
  };
  const personOf = linkedPersonOf(engine.db);
  for (const userId of enrolledMembers(engine.db)) {
    report.members++;
    const person = personOf(userId);
    const featured = person ? (featuredByPerson.get(person) ?? null) : null;
    if (featured) {
      report.featuredGiven++;
    }
    const before = profilePhotoOf(engine.db, userId);
    try {
      const seen: { featuredNotTheirs?: boolean } = {};
      const outcome = await ensureDefaultProfilePhoto(engine, userId, fetchFn, {
        featured,
        present,
        dryRun,
        report: seen,
      });
      report[outcome]++;
      if (seen.featuredNotTheirs) {
        report.featuredNotTheirs++;
      }
      if (before.source === 'chosen' && outcome.startsWith('set_')) {
        report.chosenGoneReplaced++;
      }
    } catch (e) {
      report.failed++;
      log.error('default profile photo failed for a member; the run goes on', {
        message: (e as Error).message,
      });
    }
  }
  log.info(dryRun ? 'default profile photos, dry run' : 'default profile photos', report);
  return report;
}

/** The background re-evaluation of each member, while it runs. */
const inFlight = new Map<string, Promise<void>>();

/**
 * Re-evaluate one member's default in the background (the avatar found no valid photo). At most
 * one per member at a time; never awaited by the request; a failure is logged.
 */
export function scheduleDefaultProfilePhoto(
  engine: FaceEngine,
  userId: string,
  fetchFn: typeof fetch
): void {
  if (inFlight.has(userId)) {
    return;
  }
  const run = ensureDefaultProfilePhoto(engine, userId, fetchFn)
    .then((outcome) => log.info('default profile photo re-evaluated', { outcome }))
    .catch((e: unknown) =>
      log.error('default profile photo re-evaluation failed', { message: (e as Error).message })
    )
    .finally(() => inFlight.delete(userId));
  inFlight.set(userId, run);
}

/**
 * The end of every background re-evaluation running now. Never rejects. What a caller that must
 * see their results awaits (the tests), instead of a clock - and what a test awaits before the
 * next one, since a run left in flight makes the next schedule for that member a no-op.
 */
export async function defaultPhotosSettled(): Promise<void> {
  await Promise.all(inFlight.values());
}
