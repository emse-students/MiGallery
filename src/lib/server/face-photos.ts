/**
 * The read side of face matching (lot A6, docs/wiki/face-matching-option-c.md): which photos are a
 * member's, which faces wait for their answer, and the photos themselves, fetched from Immich BY
 * ID. Everything reads `face_matches` (written by face-engine.ts alone); nothing here reads an
 * Immich person or face, which lot A8 deletes.
 *
 * A MEMBER'S PHOTOS are the assets of the faces they hold that are shown without a question: a
 * row of theirs, not rejected, and either `auto` or confirmed by them. A `suggested` face waiting
 * for their answer is NOT one of their photos until they say yes.
 *
 * Nothing here returns a distance, a band name, a runner-up or another member's id: what leaves
 * this module is asset ids and face indexes of the member's OWN faces.
 */

import type { DatabaseInstance } from '#lib/db/database.ts';
import { FACE_MODEL } from '#lib/face-embedding.ts';
import type { FaceKey } from '#lib/server/face-store.ts';
import { referenceCount } from '#lib/server/face-enrolment.ts';
import { searchAssetsByIds } from '#lib/server/immich-search.ts';
import { getAlbumAssets } from '#lib/photos-cv/handlers.ts';
import { createLogger } from '#lib/server/logger.ts';
import type { ImmichAsset } from '#lib/types/api.ts';

const log = createLogger('face-photos');

/**
 * The SQL condition (on `face_matches` columns) of a face shown to its holder without a question.
 * The ONE spelling of "a member's photo": every reader uses it.
 */
export const VISIBLE_MATCH_SQL = "state != 'rejected' AND (band = 'auto' OR state = 'confirmed')";
const VISIBLE = VISIBLE_MATCH_SQL;
/** The SQL condition of a face waiting for its holder's answer. */
const TO_CONFIRM = "band = 'suggested' AND state = 'pending'";
/** The SQL condition of a face shown without a question that its holder may still refuse. */
const SHOWN = "band = 'auto' AND state = 'pending'";

/** The distinct assets of `userId`'s visible faces, oldest match first. */
export function memberPhotoAssetIds(db: DatabaseInstance, userId: string): string[] {
  const rows = db
    .prepare(
      `SELECT asset_id FROM face_matches WHERE user_id = ? AND model = ? AND ${VISIBLE}
        GROUP BY asset_id ORDER BY MIN(created_at), asset_id`
    )
    .all(userId, FACE_MODEL) as Array<{ asset_id: string }>;
  return rows.map((r) => r.asset_id);
}

/**
 * The faces given to `userId` that wait for their yes or no, NEAREST FIRST (owner, 2026-11-01): the
 * likeliest to be theirs at the top, so "confirm all above" is safe where the list is surest. Ties
 * by the face's key, so the order is total. The order is all that leaves: never the distance.
 */
export function pendingSuggestions(db: DatabaseInstance, userId: string): FaceKey[] {
  const rows = db
    .prepare(
      `SELECT asset_id, face_index FROM face_matches WHERE user_id = ? AND model = ? AND ${TO_CONFIRM}
        ORDER BY distance, asset_id, face_index`
    )
    .all(userId, FACE_MODEL) as Array<{ asset_id: string; face_index: number }>;
  return rows.map((r) => ({ assetId: r.asset_id, faceIndex: r.face_index }));
}

/**
 * The faces given to `userId` WITHOUT a question that they have not answered (`auto`, pending),
 * LEAST SURE FIRST (faces v2, "Pas moi" from Mes photos): auto is sticky, so a stranger shown as
 * theirs leaves only by their "not me", and the faces likeliest to be wrong are at the top. A face
 * they confirmed is not listed (they already said yes). Ties by the face's key; never the distance.
 */
export function shownFaces(db: DatabaseInstance, userId: string): FaceKey[] {
  const rows = db
    .prepare(
      `SELECT asset_id, face_index FROM face_matches WHERE user_id = ? AND model = ? AND ${SHOWN}
        ORDER BY distance DESC, asset_id, face_index`
    )
    .all(userId, FACE_MODEL) as Array<{ asset_id: string; face_index: number }>;
  return rows.map((r) => ({ assetId: r.asset_id, faceIndex: r.face_index }));
}

/**
 * Whether `userId` holds `face` now - shown or waiting for their answer - which is the ONLY
 * condition under which its crop may be served to them. A face they rejected is not held.
 */
export function holdsFace(db: DatabaseInstance, userId: string, face: FaceKey): boolean {
  const row = db
    .prepare(
      `SELECT 1 AS held FROM face_matches WHERE asset_id = ? AND face_index = ? AND model = ?
        AND user_id = ? AND state != 'rejected'`
    )
    .get(face.assetId, face.faceIndex, FACE_MODEL, userId);
  return row != null;
}

/**
 * The face of `userId` in photo `assetId` that a profile photo is cut around: their lowest-indexed
 * VISIBLE face there, or null when the photo is not one of theirs (never matched, rejected, still
 * waiting for an answer, or given to someone else since).
 */
export function profileFace(db: DatabaseInstance, userId: string, assetId: string): FaceKey | null {
  const row = db
    .prepare(
      `SELECT MIN(face_index) AS face_index FROM face_matches
        WHERE asset_id = ? AND model = ? AND user_id = ? AND ${VISIBLE}`
    )
    .get(assetId, FACE_MODEL, userId) as { face_index: number | null } | null;
  if (row?.face_index == null) {
    return null;
  }
  return { assetId, faceIndex: row.face_index };
}

/**
 * For each of `userId`'s photos, the face {@link profileFace} would cut: their lowest-indexed
 * visible face there. What the profile photo picker's tiles show.
 */
export function visibleProfileFaces(db: DatabaseInstance, userId: string): FaceKey[] {
  const rows = db
    .prepare(
      `SELECT asset_id, MIN(face_index) AS face_index FROM face_matches
        WHERE user_id = ? AND model = ? AND ${VISIBLE} GROUP BY asset_id ORDER BY asset_id`
    )
    .all(userId, FACE_MODEL) as Array<{ asset_id: string; face_index: number }>;
  return rows.map((r) => ({ assetId: r.asset_id, faceIndex: r.face_index }));
}

/**
 * The capture date (ms) of each asset Immich still has, by id: `fileCreatedAt` (Immich's capture
 * date, from the photo's metadata), else `localDateTime`. An asset Immich no longer has, or one
 * without a readable date, is absent from the map. Throws as searchAssetsByIds does.
 */
export async function assetCaptureTimes(
  fetchFn: typeof fetch,
  assetIds: readonly string[]
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (assetIds.length === 0) {
    return out;
  }
  for (const asset of await searchAssetsByIds(fetchFn, [...new Set(assetIds)])) {
    const t = Date.parse(asset.fileCreatedAt ?? asset.localDateTime ?? '');
    if (Number.isFinite(t)) {
      out.set(asset.id, t);
    }
  }
  log.debug('capture dates read', { asked: assetIds.length, dated: out.size });
  return out;
}

/** What the screens need to know of a member's face matching, as counts. */
export interface FaceStatus {
  /** They hold references or photos: the face feature is on for them. */
  enrolled: boolean;
  /** Their photos (distinct assets). */
  photos: number;
  /** Faces waiting for their answer. */
  toConfirm: number;
}

/** {@link FaceStatus} of `userId`, read in three indexed queries. */
export function faceStatus(db: DatabaseInstance, userId: string): FaceStatus {
  const photos = (
    db
      .prepare(
        `SELECT COUNT(DISTINCT asset_id) AS n FROM face_matches
          WHERE user_id = ? AND model = ? AND ${VISIBLE}`
      )
      .get(userId, FACE_MODEL) as { n: number }
  ).n;
  const toConfirm = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM face_matches WHERE user_id = ? AND model = ? AND ${TO_CONFIRM}`
      )
      .get(userId, FACE_MODEL) as { n: number }
  ).n;
  const enrolled = photos > 0 || toConfirm > 0 || referenceCount(db, userId) > 0;
  return { enrolled, photos, toConfirm };
}

/** Which of a member's photos: all of them, those outside the PhotoCV album, or those in it. */
export type MemberPhotoScope = 'all' | 'outside_cv' | 'in_cv';

/**
 * The Immich assets of `userId`'s photos, newest first, images only (as the person-based listing
 * always was). The ids come from `face_matches`; the assets from Immich BY ID
 * (`searchAssetsByIds`, which refuses an answer naming an asset that was not asked for). The
 * PhotoCV partition reads that album's members once.
 */
export async function memberPhotoAssets(
  fetchFn: typeof fetch,
  db: DatabaseInstance,
  userId: string,
  scope: MemberPhotoScope
): Promise<ImmichAsset[]> {
  let ids = memberPhotoAssetIds(db, userId);
  log.debug('member photos asked', { scope, matched: ids.length });
  if (ids.length === 0) {
    return [];
  }
  if (scope !== 'all') {
    const inCv = new Set((await getAlbumAssets(fetchFn)).map((a) => a.id));
    ids = ids.filter((id) => (scope === 'in_cv' ? inCv.has(id) : !inCv.has(id)));
  }
  const assets = (await searchAssetsByIds(fetchFn, ids)).filter((a) => a.type === 'IMAGE');
  const when = (a: ImmichAsset) => Date.parse(a.fileCreatedAt ?? a.createdAt ?? '') || 0;
  assets.sort((a, b) => when(b) - when(a));
  log.info('member photos served', { scope, matched: ids.length, found: assets.length });
  return assets;
}
