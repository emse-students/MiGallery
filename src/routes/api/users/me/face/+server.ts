import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getDatabase } from '#lib/db/database.ts';
import { requireScope } from '#lib/server/permissions.ts';
import { createLogger } from '#lib/server/logger.ts';
import { m } from '#lib/paraglide/messages.js';
import { finishLocalErasure, inTransaction } from '#lib/server/face-erasure.ts';
import { applyFaceLink } from '#lib/server/face-link.ts';
import { isImpersonating } from '#lib/server/auth.ts';
import { normalisePersonId } from '#lib/server/face-access.ts';

const log = createLogger('user-face');

/**
 * PATCH /api/users/me/face
 * The WITHDRAWAL of face matching (`person_id: null`), by the member or by an admin for a member;
 * and, for an ADMIN only, the legacy Immich person link (`users.photos_id`) that lot A7 migrates.
 *
 * Body:
 * - person_id: null to withdraw; a person id is accepted from an admin only. A member enrols with
 *   a selfie (`POST /api/users/me/face/enrolment`) since lot A5: the old member link, proved by a
 *   selfie uploaded to Immich, is retired (lot A6), so a member's person id is refused (400).
 * - user_id: string (optional, admin only) - Allows editing another user
 *
 * The profile photo is `PUT /api/users/me/profile-photo` since lot A6.
 *
 * Every change goes through {@link applyFaceLink}: the grants the member gave go, the consent
 * closes, the references, matches and face crops go, an old Immich person is journaled for
 * clearing - in one transaction with the write. Nothing here may be done by an admin
 * impersonating the member.
 */
export const PATCH: RequestHandler = async (event) => {
  const { request } = event;

  const auth = await requireScope(event, 'read');

  try {
    const db = getDatabase();
    const body = (await request.json()) as {
      person_id?: string | null;
      user_id?: string;
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

    // A member withdraws; only an admin may still write a person link (lot A7 reads them).
    if (rawPersonId !== null && !isAdmin) {
      log.warn('member person link refused: retired since lot A6');
      return json(
        { error: 'person_link_retired', message: m.face_person_link_retired() },
        { status: 400 }
      );
    }
    // One spelling of a person id (face-access.ts): an admin may still store a non-UUID test id.
    const personId = rawPersonId === null ? null : (normalisePersonId(rawPersonId) ?? rawPersonId);

    const exists = db.prepare('SELECT 1 AS found FROM users WHERE id_user = ?').get(userId);
    if (!exists) {
      return json({ error: 'User not found' }, { status: 404 });
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

    const selfService = !!auth.user && userId === auth.user.id_user;
    const result = inTransaction(db, () =>
      applyFaceLink(db, userId, personId, {
        source: 'admin',
        unlinkReason: selfService ? 'withdrawal' : 'admin_unlink',
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
