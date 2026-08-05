/**
 * Resolving who a request is coming from.
 *
 * There is exactly ONE answer to that question - the session row behind the
 * cookie (`$lib/db/sessions`). No cookie is ever trusted for its contents, and
 * there is no fallback chain: a request either carries a live session or it is
 * anonymous.
 */
import { getSession } from '$lib/session';
import { createLogger } from '$lib/server/logger';
import { loginBounceTarget } from '$lib/auth-redirect';
import type { ResolvedSession } from '$lib/db/sessions';
import type { UserRow } from '$lib/types/api';
import { redirect, type Cookies } from '@sveltejs/kit';

const log = createLogger('auth');

/** Kept as an object so the many call sites read the same on both sides. */
export interface AuthContext {
	locals: App.Locals;
	cookies: Cookies;
}

/** The live session of the request, or null. */
export function getRequestSession({ cookies }: AuthContext): ResolvedSession | null {
	return getSession(cookies);
}

/**
 * The user the request acts as - the impersonated one while an admin
 * impersonates, the account itself otherwise.
 */
export function getCurrentUser(context: AuthContext): UserRow | null {
	return getRequestSession(context)?.user ?? null;
}

/**
 * The account that actually authenticated, ignoring any impersonation.
 * Only authorisation decisions ABOUT an impersonation may use this.
 */
export function getRealUser(context: AuthContext): UserRow | null {
	return getRequestSession(context)?.realUser ?? null;
}

function isAdmin(user: UserRow | null): boolean {
	return (user?.role || 'user') === 'admin';
}

/**
 * The admin behind the request, or null.
 *
 * Deliberately judged on the EFFECTIVE user: an admin who is impersonating a
 * regular user must not keep admin rights while doing so.
 */
export function ensureAdmin(context: AuthContext): UserRow | null {
	const user = getCurrentUser(context);
	if (!isAdmin(user)) {
		return null;
	}

	return user;
}

/**
 * The admin behind a PAGE request, or a redirect out of it.
 *
 * The two refusals are not the same refusal, which is why this exists rather
 * than a bare `if (!ensureAdmin(...))`: an ANONYMOUS visitor keeps the path
 * they asked for, so signing in returns them to it, while a logged-in
 * non-admin is simply sent home - a destination there would bounce them
 * straight back into the same refusal.
 *
 * Pages only. API handlers answer a status code (`requireAdminSession`), never
 * a redirect.
 */
export function requireAdminPage(context: AuthContext, url: URL): UserRow {
	const user = getCurrentUser(context);
	if (!user) {
		throw redirect(303, loginBounceTarget(url.pathname + url.search));
	}

	if (!isAdmin(user)) {
		throw redirect(303, '/');
	}

	return user;
}

/** True when the real account may end an impersonation on its own session. */
export function canStopImpersonating(context: AuthContext): boolean {
	const session = getRequestSession(context);
	if (!session) {
		return false;
	}

	if (!isAdmin(session.realUser)) {
		log.warn('non-admin session tried to stop an impersonation', { id: session.realUser.id_user });

		return false;
	}

	return true;
}
