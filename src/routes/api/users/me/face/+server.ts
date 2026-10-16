import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getDatabase } from '$lib/db/database';
import { requireScope } from '$lib/server/permissions';
import { createLogger } from '$lib/server/logger';
import { m } from '$lib/paraglide/messages';
import { finishLocalErasure, inTransaction } from '$lib/server/face-erasure';
import { applyFaceLink } from '$lib/server/face-link';
import { isImpersonating } from '$lib/server/auth';
import { normalisePersonId, selfieProves } from '$lib/server/face-access';

const log = createLogger('user-face');

/**
 * PATCH /api/users/me/face
 * Updates the person ID (photos_id) of the logged-in user
 *
 * Body:
 * - person_id: string | null (required) - The person ID to associate
 * - user_id: string (optional, admin only) - Allows editing another user
 * - photos_asset_id: string | null (optional) - the profile photo's backing asset
 * - selfie_asset_id: string - required when a MEMBER links a person other than their current
 *   one: the selfie just uploaded, in which Immich found exactly that person (selfieProves)
 *
 * Every change of the person goes through {@link applyFaceLink}: the old person's grants go, its
 * consent closes, its Immich name is journaled for clearing, a new consent is recorded - in one
 * transaction with the write. Nothing here may be done by an admin impersonating the member.
 */
export const PATCH: RequestHandler = async (event) => {
  const { request } = event;

  const auth = await requireScope(event, 'read');

  try {
    const db = getDatabase();
    const body = (await request.json()) as {
      person_id?: string | null;
      user_id?: string;
      photos_asset_id?: string | null;
      selfie_asset_id?: unknown;
    };

    // A link, a withdrawal and a profile photo are the member's own acts and consents: an admin
    // "acting as" them must not make any of them.
    if (isImpersonating(event)) {
      log.warn('face change refused while impersonating');
      return json({ error: 'Not allowed while impersonating' }, { status: 403 });
    }

    // A session-authenticated admin gets grantedScope 'read' here (requireScope
    // only returns 'admin' for the 'admin' required-scope or an admin API key),
    // so gate cross-user edits on the actual role, not the granted scope.
    const isAdmin = auth.grantedScope === 'admin' || auth.user?.role === 'admin';

    // Anything other than an explicit admin edit targets the session's own user.
    // An API key carries no user, so it must name one to get anywhere.
    const userId: string | null =
      isAdmin && body.user_id ? body.user_id : (auth.user?.id_user ?? null);

    if (!userId) {
      return json({ error: 'Unauthorized - no user identified' }, { status: 401 });
    }

    const rawPersonId = body.person_id;

    if (rawPersonId !== null && (rawPersonId === undefined || typeof rawPersonId !== 'string')) {
      return json({ error: 'person_id is required and must be a string or null' }, { status: 400 });
    }

    // One spelling of a person id (face-access.ts): the link IS what the photo rule trusts, so a
    // second spelling of someone else's person must never be storable. An admin may still store
    // a non-UUID test id as given; a member may not.
    const normalised = rawPersonId === null ? null : normalisePersonId(rawPersonId);
    if (rawPersonId !== null && !normalised && !isAdmin) {
      return json({ error: 'person_id must be an Immich person id' }, { status: 400 });
    }
    const personId = rawPersonId === null ? null : (normalised ?? rawPersonId);

    const exists = db.prepare('SELECT photos_id FROM users WHERE id_user = ?').get(userId) as {
      photos_id: string | null;
    } | null;
    if (!exists) {
      return json({ error: 'User not found' }, { status: 404 });
    }

    // A member links a NEW person only with the proof the selfie flow produces: a photo they just
    // uploaded in which Immich found exactly that one person (a speed bump, not a proof of
    // identity - docs/wiki/photos-cv.md). Keeping their current person (the profile-photo change)
    // needs no proof. An admin skips it, and the consent then says so: source 'admin'.
    const skippedProof = isAdmin;
    if (personId && !isAdmin && normalisePersonId(exists.photos_id) !== personId) {
      const proof = await selfieProves(event.fetch, body.selfie_asset_id, personId, userId);
      if (!proof.ok) {
        log.warn('face link refused: no selfie proof', { userId, personId, reason: proof.reason });
        return json(
          { error: 'selfie_proof_required', message: m.face_selfie_proof_msg() },
          { status: 403 }
        );
      }
    }

    if (personId) {
      const existingUser = db
        .prepare('SELECT id_user FROM users WHERE photos_id = ? AND id_user != ?')
        .get(personId, userId) as { id_user: string } | undefined;

      if (existingUser) {
        return json(
          { error: 'face_already_assigned', message: m.face_already_assigned_msg() },
          { status: 409 }
        );
      }
    }

    // photos_asset_id is optional: when the caller sets a profile photo it also
    // sends the backing Immich asset id, so /api/users/[username]/avatar can
    // generate MiGallery's own square crop from it. Only touched when present in
    // the body (a plain person association leaves it unchanged).
    const setAsset = Object.prototype.hasOwnProperty.call(body, 'photos_asset_id');
    const assetId = body.photos_asset_id ?? null;
    if (setAsset && assetId !== null && typeof assetId !== 'string') {
      return json({ error: 'photos_asset_id must be a string or null' }, { status: 400 });
    }

    const selfService = !!auth.user && userId === auth.user.id_user;
    const result = inTransaction(db, () =>
      applyFaceLink(db, userId, personId, {
        source: skippedProof ? 'admin' : 'selfie',
        unlinkReason: selfService ? 'withdrawal' : 'admin_unlink',
        assetId: setAsset ? assetId : undefined,
      })
    );
    if (result.local) {
      finishLocalErasure(result.local);
    }
    log.info('face link written', {
      changed: result.changed,
      unlinked: personId === null,
      erasureJournaled: result.local?.erasure != null,
    });

    return json({ success: true, person_id: personId });
  } catch (e) {
    const err = e as Error & { code?: string };
    // The unique index on photos_id caught a concurrent link of the same person.
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      log.warn('face link refused: the person was linked concurrently');
      return json(
        { error: 'face_already_assigned', message: m.face_already_assigned_msg() },
        { status: 409 }
      );
    }
    log.error('PATCH /api/users/me/face failed', { message: err.message, stack: err.stack });
    return json({ error: err.message }, { status: 500 });
  }
};
