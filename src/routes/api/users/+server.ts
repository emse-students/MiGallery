import { json } from '@sveltejs/kit';
import type { UserRow } from '#lib/types/api.ts';
import type { RequestHandler } from './$types';
import { getDatabase } from '#lib/db/database.ts';
import { logEvent } from '#lib/server/logs.ts';
import { requireScope } from '#lib/server/permissions.ts';
import { isImpersonating } from '#lib/server/auth.ts';
import { resolveAdminPersonLink } from '#lib/server/face-access.ts';
import { withdrawFaceConsent } from '#lib/server/face-consent.ts';
import { inTransaction } from '#lib/server/face-erasure.ts';
import { applyFaceLink } from '#lib/server/face-link.ts';

import { createLogger } from '#lib/server/logger.ts';
import { isUniqueViolation } from '#lib/server/route-errors.ts';

const log = createLogger('users');

export const GET: RequestHandler = async (event) => {
  await requireScope(event, 'admin');

  const db = getDatabase();
  const rows = db
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
			FROM users
			ORDER BY promo DESC, name, first_name`
    )
    .all() as UserRow[];
  return json({ success: true, users: rows });
};

export const POST: RequestHandler = async (event) => {
  await requireScope(event, 'admin');
  // Creating a member can bind a face: not in the name of an account only being acted as.
  if (isImpersonating(event)) {
    return json({ error: 'Not allowed while impersonating' }, { status: 403 });
  }

  try {
    const body = (await event.request.json()) as {
      id_user?: string;
      name?: string;
      first_name?: string | null;
      last_name?: string | null;
      role?: string;
      promo?: number | null;
      photos_id?: string | null;
      formation?: string | null;
    };

    const id_user = body.id_user;
    const first_name = body.first_name ?? null;
    const last_name = body.last_name ?? null;
    const legacyName = [first_name, last_name].filter(Boolean).join(' ').trim();
    const name = body.name ?? (legacyName || null);
    const role = body.role ?? 'user';
    const promo = body.promo ?? null;
    // One spelling of a person id, never one another member holds (face-access.ts).
    const link = resolveAdminPersonLink(body.photos_id, id_user ?? '');
    if (!link.ok) {
      return link.reason === 'invalid'
        ? json({ error: 'photos_id must be a string or null' }, { status: 400 })
        : json({ error: 'photos_id belongs to another member' }, { status: 409 });
    }
    const photos_id = link.personId ?? null;
    const formation = body.formation ?? null;

    if (!id_user || !name) {
      return json({ error: 'id_user and name required' }, { status: 400 });
    }

    if (!['user', 'admin', 'mitviste'].includes(role)) {
      return json({ error: 'Invalid role' }, { status: 400 });
    }

    const db = getDatabase();
    const insert = db.prepare(
      'INSERT INTO users (id_user, name, first_name, last_name, role, promo, formation) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    // The row and its link are written together or not at all, the link through applyFaceLink
    // like every other. A consent row left open by an earlier account of the same id would make
    // recordFaceConsent skip the admin consent, so it is closed first.
    const info = inTransaction(db, () => {
      withdrawFaceConsent(db, id_user);
      const run = insert.run(id_user, name, first_name, last_name, role, promo, formation);
      if (photos_id) {
        applyFaceLink(db, id_user, photos_id, { source: 'admin', unlinkReason: 'admin_unlink' });
      }
      return run;
    });
    const created = db
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
      .get(id_user) as UserRow | undefined;

    try {
      await logEvent(event, 'create', 'user', id_user, { name, first_name, last_name, role });
    } catch (logErr) {
      log.warn('logEvent failed (users POST):', logErr);
    }
    return json({ success: true, created, changes: info.changes });
  } catch (e) {
    const err = e as Error;
    // A duplicate is the client's (409, a warning); anything else is the server's (500, an error).
    if (isUniqueViolation(e)) {
      log.warn('POST /api/users: refused 409', { message: err.message });
    } else {
      log.error('POST /api/users error', err);
    }
    if (err.message.includes('users.photos_id')) {
      return json(
        { success: false, error: 'photos_id belongs to another member' },
        { status: 409 }
      );
    }
    if (isUniqueViolation(e)) {
      return json({ success: false, error: 'User already exists' }, { status: 409 });
    }
    return json({ success: false, error: err.message }, { status: 500 });
  }
};
