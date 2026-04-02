import { SvelteKitAuth } from '@auth/sveltekit';
import { env } from '$env/dynamic/private';
import type { JWT } from '@auth/core/jwt';
import type { Session } from '@auth/core/types';
import type { Provider } from '@auth/core/providers';
import { getUserByCasId, createUser } from '$lib/db/users';

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

function computeNom(profile: Record<string, unknown>, fallbackId: string) {
	const given = typeof profile.firstName === 'string' ? profile.firstName.trim() : '';
	const family = typeof profile.lastName === 'string' ? profile.lastName.trim() : '';
	if (given || family) {
		const full = `${given} ${family}`.trim();
		return full || fallbackId;
	}

	const fullName = typeof profile.name === 'string' ? profile.name.trim() : '';
	return fullName || fallbackId;
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
			// Claims utilises: id (sub), name, firstName, lastName, promo
			scope: 'openid profile promo name firstName lastName'
		}
	}
];

export const { handle, signIn, signOut } = SvelteKitAuth({
	providers,
	trustHost: env.AUTH_TRUSTED_HOST === 'true',
	secret: env.AUTH_SECRET,
	callbacks: {
		signIn({ account, profile }) {
			if (!account || !profile) {
				return false;
			}

			if (account.provider === 'miconnect') {
				const userId = profile.sub!;
				const existingUser = getUserByCasId(userId);

				if (!existingUser) {
					const profileMap = profile as Record<string, unknown>;
					const nom = computeNom(profileMap, userId);
					const promoYear = parsePromo(profileMap.promo);

					createUser({
						id_user: userId,
						nom,
						role: 'user',
						promo_year: promoYear
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
					token.promo_year = parsePromo(profileMap.promo);
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
