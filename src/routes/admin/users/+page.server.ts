import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { ensureAdmin } from '$lib/server/auth';
import { getDatabase } from '$lib/db/database';
import type { UserRow } from '$lib/types/api';

const SYSTEM_USER_ID = 'dd68bb5b4f7c56878a1bd873593a3e7c3434242c80871e4ead9fe99d3f48a782';

export const load: PageServerLoad = async ({ locals, cookies }) => {
	const admin = await ensureAdmin({ locals, cookies });
	if (!admin) {
		throw redirect(303, '/');
	}

	const db = getDatabase();
	const users = db
		.prepare(
			`SELECT id_user, name, first_name, last_name, photos_id, role, promo, formation
			 FROM users
			 WHERE id_user != ?
			 ORDER BY role, promo DESC, name`
		)
		.all(SYSTEM_USER_ID) as UserRow[];

	return { users, currentUserId: admin.id_user };
};
