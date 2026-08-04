/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
import { getDatabase } from '$lib/db/database';
import type { RequestEvent } from '@sveltejs/kit';
import { getRequestSession } from '$lib/server/auth';
import { createLogger } from '$lib/server/logger';

const log = createLogger('audit-log');

/**
 * Log an event to the local DB `logs` table.
 * event: the SvelteKit request event (used to extract actor/ip when possible)
 */
export function logEvent(
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
			// An audit trail names the account that ACTED. While an admin impersonates
			// someone, that is still the admin - so the session is asked first, and for
			// its real user, rather than for the identity the request is wearing.
			if (event?.cookies) {
				const session = getRequestSession({ locals: event.locals, cookies: event.cookies });
				if (session) {
					actor = session.realUser.id_user;
				}
			}

			if (!actor && event?.locals) {
				const localUser = (event.locals as any).user;
				if (localUser) {
					actor = (localUser.id_user || localUser.id || localUser.email) as string;
				}

				if (!actor && (event.locals as any).userId) {
					actor = (event.locals as any).userId as string;
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
		log.warn('logEvent failed', (e as Error).message || e);
	}
}
