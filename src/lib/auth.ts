import { SvelteKitAuth } from '@auth/sveltekit';
import { env } from '$env/dynamic/private';
import type { JWT } from '@auth/core/jwt';
import type { Session } from '@auth/core/types';
import type { Provider } from '@auth/core/providers';
import { getUserByCasId, createUser } from '$lib/db/users';

const SYSTEM_USER_ID = 'dd68bb5b4f7c56878a1bd873593a3e7c3434242c80871e4ead9fe99d3f48a782';

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

function computeName(profile: Record<string, unknown>, fallbackId: string): string {
	const fullName = typeof profile.name === 'string' ? profile.name.trim() : '';
	if (fullName) {
		return fullName;
	}

	const firstName = typeof profile.firstName === 'string' ? profile.firstName.trim() : '';
	const lastName = typeof profile.lastName === 'string' ? profile.lastName.trim() : '';
	const combined = `${firstName} ${lastName}`.trim();

	return combined || fallbackId;
}

const providers: Provider[] = [
	{
		id: 'miconnect',
		name: 'MiConnect',
		type: 'oidc',
		// Issuer Authentik : https://auth.canari-emse.fr/application/o/migallery/
		issuer: env.MICONNECT_ISSUER,
		clientId: env.MICONNECT_CLIENT_ID,
		clientSecret: env.MICONNECT_CLIENT_SECRET,
		checks: ['pkce', 'state'],
		authorization: {
			// Claims attendus depuis Authentik
			scope: 'openid profile promo name formation'
		}
	}
];

export const { handle, signIn, signOut } = SvelteKitAuth({
	providers,
	trustHost: env.AUTH_TRUSTED_HOST === 'true',
	secret: env.AUTH_SECRET,
	callbacks: {
		signIn({ user, account, profile }) {
			if (!account || !profile) {
				return false;
			}

			if (account.provider === 'miconnect') {
				console.debug(
					`Utilisateur connecté ! Infos : ${JSON.stringify(user)}\n\n${JSON.stringify(profile)}\n\n${JSON.stringify(account)}`
				);

				const userId = profile.sub!;
				const existingUser = getUserByCasId(userId);

				if (!existingUser) {
					const profileMap = profile as Record<string, unknown>;
					const role = userId === SYSTEM_USER_ID ? 'admin' : 'user';

					createUser({
						id_user: userId,
						name: computeName(profileMap, userId),
						first_name: typeof profileMap.firstName === 'string' ? profileMap.firstName.trim() : null,
						last_name: typeof profileMap.lastName === 'string' ? profileMap.lastName.trim() : null,
						promo: parsePromo(profileMap.promo),
						role,
						photos_id: null
					});
				}
				return true;
			}

			return false;
		},

		jwt({ token, account, profile }): JWT {
			if (account && profile) {
				if (account.provider === 'miconnect') {
					token.id = profile.sub;
					const profileMap = profile as Record<string, unknown>;
					token.promo = parsePromo(profileMap.promo);
				}
			}
			return token;
		},

		session({ session, token }: { session: Session; token: JWT }): Session {
			if (token && session.user) {
				session.user.id = token.id as string;
				session.user.name = token.name as string;
			}
			return session;
		}
	}
});
