import { json, isHttpError } from '@sveltejs/kit';
import { ensureError } from '$lib/ts-utils';
import type { RequestHandler } from './$types';
import { getDatabase } from '$lib/db/database';
import { requireScope } from '$lib/server/permissions';
import { isImpersonating } from '$lib/server/auth';
import { logEvent } from '$lib/server/logs';
import {
  deleteUserAccount,
  DELETED_ID,
  finishLocalErasure,
  inTransaction,
} from '$lib/server/face-erasure';
import { resolveAdminPersonLink } from '$lib/server/face-access';
import { applyFaceLink } from '$lib/server/face-link';

import { createLogger } from '$lib/server/logger';

const log = createLogger('users-id');
const SYSTEM_USER_ID = 'dd68bb5b4f7c56878a1bd873593a3e7c3434242c80871e4ead9fe99d3f48a782';

export const GET: RequestHandler = async (event) => {
  await requireScope(event, 'admin');

  const targetId = event.params.id;
  if (!targetId) {
    return json({ error: 'Bad Request' }, { status: 400 });
  }

  const db = getDatabase();
  const row = db
    .prepare(
      `SELECT
				id_user,
				name,
				first_name,
				last_name,
				photos_id,
				role,
				promo,
				formation
			FROM users WHERE id_user = ? LIMIT 1`
    )
    .get(targetId);
  if (!row) {
    return json({ error: 'Not Found' }, { status: 404 });
  }
  return json({ success: true, user: row });
};

export const PUT: RequestHandler = async (event) => {
  const auth = await requireScope(event, 'admin');

  const targetId = event.params.id;
  if (!targetId) {
    return json({ error: 'Bad Request' }, { status: 400 });
  }

  if (targetId === SYSTEM_USER_ID) {
    return json({ error: 'Cannot modify system user' }, { status: 403 });
  }

  try {
    const body = (await event.request.json()) as {
      name?: string;
      first_name?: string | null;
      last_name?: string | null;
      role?: string;
      promo?: number | null;
      photos_id?: string | null;
      formation?: string | null;
    };
    // An impersonated session may edit a profile but never move a member's face link: that
    // erases or re-binds biometric data in the name of an account the admin is only acting as.
    if (body.photos_id !== undefined && isImpersonating(event)) {
      return json({ error: 'Not allowed while impersonating' }, { status: 403 });
    }
    const first_name = body.first_name ?? null;
    const last_name = body.last_name ?? null;
    const legacyName = [first_name, last_name].filter(Boolean).join(' ').trim();
    const name = body.name ?? (legacyName || targetId);
    const role = body.role;
    const promo = body.promo ?? null;
    // One spelling of a person id, never one another member holds (face-access.ts). Absent from
    // the request means "leave the link alone": the UPDATE below used to null it silently.
    const link = resolveAdminPersonLink(body.photos_id, targetId);
    if (!link.ok) {
      return link.reason === 'invalid'
        ? json({ error: 'photos_id must be a string or null' }, { status: 400 })
        : json({ error: 'photos_id belongs to another member' }, { status: 409 });
    }
    const formation = body.formation ?? null;

    // Prevent admin from removing their own admin status
    if (auth.user && auth.user.id_user === targetId) {
      const effectiveRole = role || 'user';
      if (effectiveRole !== 'admin') {
        return json({ error: 'Admins cannot remove their own admin privileges' }, { status: 403 });
      }
    }

    if (role && !['user', 'admin', 'mitviste'].includes(role)) {
      return json({ error: 'Invalid role' }, { status: 400 });
    }

    const db = getDatabase();
    // The other columns and the link move in ONE transaction. The link goes through
    // applyFaceLink (face-link.ts): a changed or cleared person drops the old person's grants,
    // closes its consent, clears the profile pointer and journals the Immich clearing.
    const outcome = inTransaction(db, () => {
      const info = db
        .prepare(
          'UPDATE users SET name = ?, first_name = ?, last_name = ?, role = ?, promo = ?, formation = ? WHERE id_user = ?'
        )
        .run(name, first_name, last_name, role || 'user', promo, formation, targetId);
      if (info.changes === 0) {
        return null;
      }
      return link.personId === undefined
        ? { changes: info.changes, local: null }
        : {
            changes: info.changes,
            local: applyFaceLink(db, targetId, link.personId, {
              source: 'admin',
              unlinkReason: 'admin_unlink',
            }).local,
          };
    });
    if (!outcome) {
      return json({ error: 'User not found' }, { status: 404 });
    }
    if (outcome.local) {
      finishLocalErasure(outcome.local);
    }
    const info = { changes: outcome.changes };

    const updated = db
      .prepare(
        `SELECT
					id_user,
					name,
					first_name,
					last_name,
					photos_id,
					role,
					promo,
					formation
				FROM users WHERE id_user = ?`
      )
      .get(targetId);
    try {
      await logEvent(event, 'update', 'user', targetId, {
        name,
        first_name,
        last_name,
        role,
        promo,
      });
    } catch (logErr) {
      log.warn('logEvent failed (users PUT):', logErr);
    }
    return json({ success: true, updated, changes: info.changes });
  } catch (e: unknown) {
    if (isHttpError(e)) {
      throw e;
    }
    const err = ensureError(e);
    if (/UNIQUE constraint failed: users\.photos_id|SQLITE_CONSTRAINT_UNIQUE/.test(err.message)) {
      return json({ error: 'photos_id belongs to another member' }, { status: 409 });
    }
    log.error('PUT /api/users/[id] error', err);
    return json({ success: false, error: err.message }, { status: 500 });
  }
};

export const DELETE: RequestHandler = async (event) => {
  const auth = await requireScope(event, 'admin');

  const targetId = event.params.id;

  // Account deletion erases face data: never in the name of an account only being acted as.
  if (isImpersonating(event)) {
    return json({ error: 'Not allowed while impersonating' }, { status: 403 });
  }
  if (auth.user && auth.user.id_user === targetId) {
    return json({ error: 'Admins cannot delete their own account' }, { status: 403 });
  }

  if (targetId === SYSTEM_USER_ID) {
    return json({ error: 'Cannot delete system user' }, { status: 403 });
  }

  const db = getDatabase();
  // Face data, grants and the audit log's mentions go with the row (face-erasure.ts).
  if (!deleteUserAccount(db, targetId)) {
    return json({ error: 'User not found' }, { status: 404 });
  }
  try {
    // The deletion itself stays on record, without the id it just erased.
    await logEvent(event, 'delete', 'user', DELETED_ID, null);
  } catch (logErr) {
    log.warn('logEvent failed (users DELETE):', logErr);
  }
  return json({ success: true, changes: 1 });
};
