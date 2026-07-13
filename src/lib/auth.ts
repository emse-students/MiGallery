import { env } from '$env/dynamic/private';
import { getUserByCasId, createUser, updateUser } from '$lib/db/users';
import { createLogger } from '$lib/server/logger';
import type { DBUser } from '$lib/db/users';

const SYSTEM_USER_ID = 'dd68bb5b4f7c56878a1bd873593a3e7c3434242c80871e4ead9fe99d3f48a782';
const log = createLogger('auth-oidc');

interface OIDCToken {
	access_token: string;
	id_token: string;
	token_type: string;
	expires_in: number;
	refresh_token?: string;
	scope?: string;
}

interface OIDCProfile {
	sub: string;
	name?: string;
	firstName?: string;
	lastName?: string;
	given_name?: string;
	family_name?: string;
	email?: string;
	promo?: string | number;
	formation?: string;
	[key: string]: unknown;
}

function getTrimmedString(value: unknown): string | null {
	return typeof value === 'string' ? value.trim() : null;
}

function getProfileSub(profile: OIDCProfile | Record<string, unknown>): string | null {
	return getTrimmedString(profile.sub);
}

/**
 * The OIDC 'sub' claim is the authoritative user identifier.
 * This is the unique ID assigned by the authentication service and never changes.
 * It becomes id_user in MiGallery's database - this is NOT a "prenom.nom" format,
 * but a long UUID-like identifier from the OIDC provider.
 */

function getProfilePromo(
	profile: OIDCProfile | Record<string, unknown>,
	customClaims: Record<string, unknown>
): unknown {
	return profile.promo ?? customClaims.promo;
}

/**
 * Base of the Authentik OIDC endpoints, like Canari: issuer origin +
 * `/application/o`. The authorize/token/userinfo endpoints are at this
 * global path; the slugged path `/application/o/<slug>/authorize/` returns 404 under
 * Authentik (the slug only serves to identify the token issuer).
 */
function getAuthEndpointBase(): string {
	const raw = (env.MICONNECT_ISSUER || '').trim();
	try {
		return `${new URL(raw).origin}/application/o`;
	} catch {
		return '';
	}
}

/**
 * Parse promo value to number
 */
function parsePromo(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === 'string' && value.trim().length > 0) {
		const n = parseInt(value, 10);
		return Number.isNaN(n) ? null : n;
	}
	return null;
}

/**
 * Compute display name from profile data
 */
function computeName(profile: OIDCProfile | Record<string, unknown>, fallbackId: string): string {
	const fullName = typeof profile.name === 'string' ? profile.name.trim() : '';
	if (fullName) {
		return fullName;
	}

	const firstName =
		typeof profile.firstName === 'string'
			? profile.firstName.trim()
			: typeof profile.given_name === 'string'
				? profile.given_name.trim()
				: '';

	const lastName =
		typeof profile.lastName === 'string'
			? profile.lastName.trim()
			: typeof profile.family_name === 'string'
				? profile.family_name.trim()
				: '';

	const combined = `${firstName} ${lastName}`.trim();
	return combined || fallbackId;
}

/**
 * Decode JWT payload (without verification - only for parsing)
 */
function decodeJWT(token: string): Record<string, unknown> | null {
	try {
		const parts = token.split('.');
		if (parts.length !== 3) {
			return null;
		}

		// JWT uses base64url encoding: replace - with + and _ with / then add padding
		const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
		const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
		const decoded = atob(padded);
		const parsed: unknown = JSON.parse(decoded);
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: null;
	} catch (e) {
		log.error('failed to decode JWT', e);
		return null;
	}
}

/**
 * Exchange authorization code for tokens
 */
async function exchangeCodeForTokens(code: string, redirectUri: string): Promise<OIDCToken | null> {
	try {
		const tokenUrl = `${getAuthEndpointBase()}/token/`;
		const response = await fetch(tokenUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded'
			},
			body: new URLSearchParams({
				grant_type: 'authorization_code',
				code,
				client_id: env.MICONNECT_CLIENT_ID as string,
				client_secret: env.MICONNECT_CLIENT_SECRET as string,
				redirect_uri: redirectUri
			}).toString()
		});

		if (!response.ok) {
			const errText = await response.text();
			log.error('token exchange failed', { status: response.status, body: errText });
			return null;
		}

		return (await response.json()) as OIDCToken;
	} catch (e) {
		log.error('token exchange error', e);
		return null;
	}
}

/**
 * Fetch and parse user profile from userinfo endpoint
 */
async function fetchUserProfile(accessToken: string): Promise<OIDCProfile | null> {
	try {
		const userinfoUrl = `${getAuthEndpointBase()}/userinfo/`;
		const response = await fetch(userinfoUrl, {
			headers: {
				Authorization: `Bearer ${accessToken}`
			}
		});

		if (!response.ok) {
			const errText = await response.text();
			log.error('userinfo fetch failed', { status: response.status, body: errText });
			return null;
		}

		return (await response.json()) as OIDCProfile;
	} catch (e) {
		log.error('failed to fetch user profile', e);
		return null;
	}
}

/**
 * Parse custom claims from ID token
 */
function extractCustomClaims(idToken: string): Record<string, unknown> | null {
	const decoded = decodeJWT(idToken);
	if (!decoded) {
		log.warn('could not decode ID token');
		return null;
	}

	// Extract all custom claims (everything that's not standard OIDC)
	const standardClaims = [
		'iss',
		'sub',
		'aud',
		'exp',
		'iat',
		'auth_time',
		'acr',
		'nonce',
		'at_hash',
		'name',
		'firstName',
		'lastName',
		'given_name',
		'family_name',
		'email',
		'email_verified',
		'picture'
	];

	const customClaims: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(decoded)) {
		if (!standardClaims.includes(key)) {
			customClaims[key] = value;
		}
	}

	return customClaims;
}

/**
 * Handle user creation/update in database
 */
function handleUserInDatabase(
	profile: OIDCProfile | Record<string, unknown>,
	customClaims: Record<string, unknown>
): DBUser | null {
	try {
		const userId = getProfileSub(profile);
		if (!userId) {
			log.error('no sub in profile');
			return null;
		}

		const existingUser = getUserByCasId(userId);
		const isAdmin = userId === SYSTEM_USER_ID;

		// Extract all available data
		const firstName =
			typeof profile.firstName === 'string'
				? profile.firstName.trim()
				: typeof profile.given_name === 'string'
					? profile.given_name.trim()
					: null;

		const lastName =
			typeof profile.lastName === 'string'
				? profile.lastName.trim()
				: typeof profile.family_name === 'string'
					? profile.family_name.trim()
					: null;

		const rawPromo = getProfilePromo(profile, customClaims);
		const promo = parsePromo(rawPromo);
		const formation =
			typeof profile.formation === 'string'
				? profile.formation.trim()
				: typeof customClaims.formation === 'string'
					? (customClaims.formation as string).trim()
					: null;

		const userData: DBUser = {
			id_user: userId,
			name: computeName(profile, userId),
			first_name: firstName,
			last_name: lastName,
			role: isAdmin ? 'admin' : 'user',
			promo,
			formation,
			photos_id: null,
			// first_login=0 if OIDC already provided the promo, 1 otherwise (modal will ask)
			first_login: promo !== null ? 0 : 1
		};

		if (!existingUser) {
			createUser(userData);
			log.info(`new user ${userData.name}`, {
				promo: userData.promo ?? null,
				formation: userData.formation ?? null
			});
		} else {
			// Always overwrite with SSO data on each login.
			// We only pass non-null fields so we don't erase manual values
			// when SSO does not provide the field (e.g. promo for staff).
			const updatePayload: Partial<DBUser> & { id_user: string } = {
				id_user: userId,
				name: userData.name
			};
			if (firstName !== null) {
				updatePayload.first_name = firstName;
			}
			if (lastName !== null) {
				updatePayload.last_name = lastName;
			}
			if (promo !== null) {
				updatePayload.promo = promo;
				updatePayload.first_login = 0;
			}
			if (formation !== null) {
				updatePayload.formation = formation;
			}

			updateUser(updatePayload);
		}

		// Re-fetch from the DB to get the real state (mitviste role, photos_id, etc.)
		const freshUser = getUserByCasId(userId);
		if (!freshUser) {
			log.error('could not re-fetch user after create/update');
			return userData;
		}
		return freshUser;
	} catch (e) {
		log.error('error handling user in database', e);
		return null;
	}
}

/**
 * Complete OAuth2/OIDC flow: code -> tokens -> profile -> database
 */
export async function completeOIDCFlow(
	code: string,
	redirectUri: string
): Promise<{ tokens: OIDCToken; profile: OIDCProfile; dbUser: DBUser } | null> {
	// Step 1: Exchange code for tokens
	const tokens = await exchangeCodeForTokens(code, redirectUri);
	if (!tokens) {
		log.error('OIDC flow failed at token exchange');
		return null;
	}

	// Step 2: Extract custom claims from ID token
	const customClaims = extractCustomClaims(tokens.id_token) || {};

	// Step 3: Fetch user profile from userinfo endpoint
	const profile = await fetchUserProfile(tokens.access_token);
	if (!profile) {
		log.error('OIDC flow failed at userinfo fetch');
		return null;
	}

	// Step 4: Handle user in database
	const dbUser = handleUserInDatabase(profile, customClaims);
	if (!dbUser) {
		log.error('OIDC flow failed at database operation');
		return null;
	}

	return { tokens, profile, dbUser };
}

/**
 * Generate OIDC authorization URL
 */
export function generateAuthorizationUrl(
	redirectUri: string,
	state: string,
	nonce: string
): string {
	const scopes = ['openid', 'profile', 'promo', 'name', 'formation'];

	const params = new URLSearchParams({
		response_type: 'code',
		client_id: env.MICONNECT_CLIENT_ID as string,
		redirect_uri: redirectUri,
		scope: scopes.join(' '),
		state,
		nonce
	});

	const authUrl = `${getAuthEndpointBase()}/authorize/?${params.toString()}`;
	return authUrl;
}

/**
 * Export session user data type
 */
export interface SessionUser {
	id: string;
	name: string;
	first_name?: string | null;
	last_name?: string | null;
	role: string;
	promo?: number | null;
	formation?: string | null;
}

/**
 * Convert DBUser to SessionUser
 */
export function toSessionUser(dbUser: DBUser): SessionUser {
	return {
		id: dbUser.id_user,
		name: dbUser.name,
		first_name: dbUser.first_name,
		last_name: dbUser.last_name,
		role: dbUser.role,
		promo: dbUser.promo,
		formation: dbUser.formation
	};
}
