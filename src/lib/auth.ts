import { env } from '$env/dynamic/private';
import { getUserByCasId, createUser, updateUser } from '$lib/db/users';
import type { DBUser } from '$lib/db/users';

const SYSTEM_USER_ID = 'dd68bb5b4f7c56878a1bd873593a3e7c3434242c80871e4ead9fe99d3f48a782';

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

function getIssuerBaseUrl(): string {
	const raw = (env.MICONNECT_ISSUER || '').trim();
	return raw.replace(/\/+$/, '');
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

		const decoded = atob(parts[1]);
		const parsed: unknown = JSON.parse(decoded);
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: null;
	} catch (e) {
		console.error('[AUTH] Failed to decode JWT:', e);
		return null;
	}
}

/**
 * Exchange authorization code for tokens
 */
async function exchangeCodeForTokens(code: string, redirectUri: string): Promise<OIDCToken | null> {
	try {
		const tokenUrl = `${getIssuerBaseUrl()}/token/`;
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
			console.error('[AUTH] Token exchange failed:', response.status, errText);
			return null;
		}

		return (await response.json()) as OIDCToken;
	} catch (e) {
		console.error('[AUTH] Token exchange error:', e);
		return null;
	}
}

/**
 * Fetch and parse user profile from userinfo endpoint
 */
async function fetchUserProfile(accessToken: string): Promise<OIDCProfile | null> {
	try {
		const userinfoUrl = `${getIssuerBaseUrl()}/userinfo/`;
		const response = await fetch(userinfoUrl, {
			headers: {
				Authorization: `Bearer ${accessToken}`
			}
		});

		if (!response.ok) {
			const errText = await response.text();
			console.error('[AUTH] Userinfo fetch failed:', response.status, errText);
			return null;
		}

		return (await response.json()) as OIDCProfile;
	} catch (e) {
		console.error('[AUTH] Failed to fetch user profile:', e);
		return null;
	}
}

/**
 * Parse custom claims from ID token
 */
function extractCustomClaims(idToken: string): Record<string, unknown> | null {
	const decoded = decodeJWT(idToken);
	if (!decoded) {
		console.warn('[AUTH] Could not decode ID token');
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
			console.error('[AUTH] No sub in profile');
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

		console.log(
			`[AUTH] Login: ${userId} — OIDC: promo=${JSON.stringify(rawPromo)} (parsed:${promo ?? 'null'}), formation=${JSON.stringify(profile.formation ?? customClaims.formation ?? null)}`
		);
		if (existingUser) {
			console.log(
				`[AUTH] DB actuelle: promo=${existingUser.promo ?? 'null'}, formation=${existingUser.formation ?? 'null'}, role=${existingUser.role}`
			);
		} else {
			console.log('[AUTH] DB actuelle: aucun utilisateur trouvé → création');
		}

		const userData: DBUser = {
			id_user: userId,
			name: computeName(profile, userId),
			first_name: firstName,
			last_name: lastName,
			role: isAdmin ? 'admin' : 'user',
			promo,
			formation,
			photos_id: null
		};

		if (!existingUser) {
			createUser(userData);
			console.warn(
				`[AUTH] Nouvel utilisateur: ${userData.name} (promo:${userData.promo ?? '?'}, formation:${userData.formation ?? '?'})`
			);
		} else {
			// Toujours écraser avec les données SSO à chaque connexion.
			// On ne passe que les champs non-null pour ne pas effacer les valeurs
			// manuelles quand le SSO ne fournit pas le champ (ex: promo pour le personnel).
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
			}
			if (formation !== null) {
				updatePayload.formation = formation;
			}

			console.log(`[AUTH] updatePayload: ${JSON.stringify(updatePayload)}`);
			updateUser(updatePayload);
			console.log(
				`[AUTH] Après update: promo=${promo !== null ? promo : '(non écrasé, SSO null)'}, formation=${formation !== null ? formation : '(non écrasé, SSO null)'}`
			);
		}

		// Re-fetcher depuis la DB pour avoir l'état réel (role mitviste, photos_id, etc.)
		const freshUser = getUserByCasId(userId);
		if (!freshUser) {
			console.error('[AUTH] Could not re-fetch user after create/update');
			return userData;
		}
		return freshUser;
	} catch (e) {
		console.error('[AUTH] Error handling user in database:', e);
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
		console.error('[AUTH] OIDC flow failed at token exchange');
		return null;
	}

	// Step 2: Extract custom claims from ID token
	const customClaims = extractCustomClaims(tokens.id_token) || {};

	// Step 3: Fetch user profile from userinfo endpoint
	const profile = await fetchUserProfile(tokens.access_token);
	if (!profile) {
		console.error('[AUTH] OIDC flow failed at userinfo fetch');
		return null;
	}

	// Step 4: Handle user in database
	const dbUser = handleUserInDatabase(profile, customClaims);
	if (!dbUser) {
		console.error('[AUTH] OIDC flow failed at database operation');
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

	const authUrl = `${getIssuerBaseUrl()}/authorize/?${params.toString()}`;
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
