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
	given_name?: string; // firstName
	family_name?: string; // lastName
	email?: string;
	promo?: string | number;
	formation?: string;
	[key: string]: unknown;
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
		typeof profile.given_name === 'string'
			? profile.given_name.trim()
			: typeof (profile as any).firstName === 'string'
				? (profile as any).firstName.trim()
				: '';

	const lastName =
		typeof profile.family_name === 'string'
			? profile.family_name.trim()
			: typeof (profile as any).lastName === 'string'
				? (profile as any).lastName.trim()
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
		return JSON.parse(decoded);
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
		console.log('[AUTH] Exchanging code for tokens...');

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

		const tokens = (await response.json()) as OIDCToken;
		console.log('[AUTH] ✓ Token exchange successful');
		console.log('[AUTH] Token response:', {
			access_token: tokens.access_token ? `${tokens.access_token.substring(0, 20)}...` : 'N/A',
			token_type: tokens.token_type,
			expires_in: tokens.expires_in,
			scope: tokens.scope || 'N/A',
			has_refresh_token: !!tokens.refresh_token
		});

		return tokens;
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
		console.log('[AUTH] Fetching user profile from userinfo endpoint...');

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

		const profile = (await response.json()) as OIDCProfile;
		console.log('[AUTH] ✓ User profile fetched');
		console.log('[AUTH] Profile data (userinfo endpoint):', {
			sub: profile.sub,
			name: profile.name || 'N/A',
			given_name: profile.given_name || 'N/A',
			family_name: profile.family_name || 'N/A',
			email: profile.email || 'N/A',
			promo: profile.promo || 'N/A',
			formation: profile.formation || 'N/A'
		});

		return profile;
	} catch (e) {
		console.error('[AUTH] Failed to fetch user profile:', e);
		return null;
	}
}

/**
 * Parse custom claims from ID token
 */
function extractCustomClaims(idToken: string): Record<string, unknown> | null {
	console.log('[AUTH] Extracting custom claims from ID token...');

	const decoded = decodeJWT(idToken);
	if (!decoded) {
		console.warn('[AUTH] Could not decode ID token');
		return null;
	}

	console.log('[AUTH] Full ID token payload:', decoded);

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

	console.log('[AUTH] Custom claims extracted:', customClaims);
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
		const userId = profile.sub || (profile as any).sub;
		if (!userId) {
			console.error('[AUTH] No sub in profile');
			return null;
		}

		console.log('[AUTH] Processing user in database for ID:', userId);

		const existingUser = getUserByCasId(userId);
		const isAdmin = userId === SYSTEM_USER_ID;

		// Extract all available data
		const firstName =
			typeof profile.given_name === 'string'
				? profile.given_name.trim()
				: typeof (profile as any).firstName === 'string'
					? (profile as any).firstName.trim()
					: null;

		const lastName =
			typeof profile.family_name === 'string'
				? profile.family_name.trim()
				: typeof (profile as any).lastName === 'string'
					? (profile as any).lastName.trim()
					: null;

		const promo = parsePromo(profile.promo || (profile as any).promo || customClaims.promo);
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
			photos_id: null
		};

		if (!existingUser) {
			console.log('[AUTH] Creating new user:', userData);
			createUser(userData);
			console.log('[AUTH] ✓ User created in database');
		} else {
			console.log('[AUTH] User already exists, updating profile...');
			// Update profile fields only (not creating duplicate)
			updateUser({
				id_user: userId,
				name: userData.name,
				first_name: firstName,
				last_name: lastName,
				promo,
				formation
			});
			console.log('[AUTH] ✓ User updated in database');
		}

		return userData;
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
	console.log('\n========== OIDC FLOW START ==========');
	console.log('[AUTH] Started OIDC flow with code:', `${code.substring(0, 20)}...`);

	// Step 1: Exchange code for tokens
	const tokens = await exchangeCodeForTokens(code, redirectUri);
	if (!tokens) {
		console.error('[AUTH] ✗ OIDC Flow failed at token exchange');
		console.log('========== OIDC FLOW FAILED ==========\n');
		return null;
	}

	// Step 2: Extract custom claims from ID token
	const customClaims = extractCustomClaims(tokens.id_token) || {};

	// Step 3: Fetch user profile from userinfo endpoint
	const profile = await fetchUserProfile(tokens.access_token);
	if (!profile) {
		console.error('[AUTH] ✗ OIDC Flow failed at userinfo fetch');
		console.log('========== OIDC FLOW FAILED ==========\n');
		return null;
	}

	// Step 4: Handle user in database
	const dbUser = handleUserInDatabase(profile, customClaims);
	if (!dbUser) {
		console.error('[AUTH] ✗ OIDC Flow failed at database operation');
		console.log('========== OIDC FLOW FAILED ==========\n');
		return null;
	}

	console.log('\n[AUTH] ✓ OIDC FLOW COMPLETE');
	console.log('[AUTH] Final user object:', {
		id: dbUser.id_user,
		name: dbUser.name,
		firstName: dbUser.first_name,
		lastName: dbUser.last_name,
		role: dbUser.role,
		promo: dbUser.promo,
		formation: dbUser.formation,
		photosId: dbUser.photos_id
	});
	console.log('========== OIDC FLOW SUCCESS ==========\n');

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
	console.log('[AUTH] Generated authorization URL:', authUrl);
	return authUrl;
}

/**
 * Export session user data type
 */
export interface SessionUser {
	id: string;
	name: string;
	firstName?: string | null;
	lastName?: string | null;
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
		firstName: dbUser.first_name,
		lastName: dbUser.last_name,
		role: dbUser.role,
		promo: dbUser.promo,
		formation: dbUser.formation
	};
}
