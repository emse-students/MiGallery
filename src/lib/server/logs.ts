/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */
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
				try {
					if (typeof (event.locals as any).auth === 'function') {
						const s = await (event.locals as any).auth();
						if (s && (s as any).user) {
							actor = ((s as any).user.id_user || (s as any).user.id || (s as any).user.email) as string;
						}
					}
				} catch (innerAuthErr) {
					console.debug('locals.auth() failed while resolving actor for logEvent:', innerAuthErr);
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
