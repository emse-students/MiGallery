/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
import { getDatabase } from '$lib/db/database';
import type { RequestEvent } from '@sveltejs/kit';
import { getUserFromSignedCookie } from '$lib/server/auth';

/**
 * Log an event to the local DB `logs` table.
 * event: the SvelteKit request event (used to extract actor/ip when possible)
 */
export async function logEvent(
	event: RequestEvent | undefined | null,
	eventType: string,
	targetType: string | null = null,
	targetId: string | null = null,
	details: unknown = null
) {
	try {
		const db = getDatabase();

		let actor: string | null = null;
		try {
			if (event?.locals) {
				const localUser = (event.locals as any).user;
				if (localUser) {
					actor = (localUser.id_user || localUser.id || localUser.email) as string;
				}

				if (!actor && (event.locals as any).userId) {
					actor = (event.locals as any).userId as string;
				}
			}

			if (!actor && event?.cookies) {
				const fromCookie = getUserFromSignedCookie(event.cookies);
				if (fromCookie) {
					actor = fromCookie.id_user;
				}
			}
		} catch {
			actor = null;
		}

		if (!actor && details && typeof details === 'object' && 'actor' in details) {
			actor = (details as any).actor;
		}

		const ip =
			(event?.request?.headers &&
				(event.request.headers.get('x-forwarded-for') || event.request.headers.get('x-real-ip'))) ||
			null;

		const stmt = db.prepare(
			'INSERT INTO logs (actor, event_type, target_type, target_id, details, ip) VALUES (?, ?, ?, ?, ?, ?)'
		);
		stmt.run(actor, eventType, targetType, targetId, details ? JSON.stringify(details) : null, ip);
	} catch (e) {
		try {
			console.warn('logEvent failed:', (e as Error).message || e);
		} catch (inner) {
			void inner;
		}
	}
}
