/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */
import { getDatabase } from '$lib/db/database';
import type { RequestEvent } from '@sveltejs/kit';

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

		// Try to resolve actor from locals.auth() or locals.userId
		let actor: string | null = null;
		try {
			if (event?.locals) {
				// locals.auth may be provided by the auth provider; call if available
				try {
					// @ts-expect-error provider auth() type may vary
					if (typeof (event.locals as any).auth === 'function') {
						const s = await (event.locals as any).auth();
						if (s && (s as any).user && (s as any).user.id_user) {
							actor = (s as any).user.id_user as string;
						}
					}
				} catch (innerAuthErr) {
					console.debug('locals.auth() failed while resolving actor for logEvent:', innerAuthErr);
				}

				if (!actor && (event.locals as any).userId) {
					actor = (event.locals as any).userId as string;
				}
			}
		} catch {
			actor = null;
		}

		const ip =
			(event?.request?.headers && (event.request.headers.get('x-forwarded-for') || event.request.headers.get('x-real-ip'))) ||
			null;

		const stmt = db.prepare(
			'INSERT INTO logs (actor, event_type, target_type, target_id, details, ip) VALUES (?, ?, ?, ?, ?, ?)'
		);
		stmt.run(actor, eventType, targetType, targetId, details ? JSON.stringify(details) : null, ip);
	} catch (e) {
		try {
			console.warn('logEvent failed:', (e as Error).message || e);
		} catch (inner) {
			// best-effort logging failed
			void inner;
		}
	}
}
