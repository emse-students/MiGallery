import { SvelteKitAuth } from '@auth/sveltekit';
import { env } from '$env/dynamic/private';
import type { JWT } from '@auth/core/jwt';
import type { Session } from '@auth/core/types';
import type { Provider } from '@auth/core/providers';
import { getUserByCasId, createUser } from '$lib/db/users';

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
			// Le claim 'promo' doit etre mappe dans Authentik via une Property Mapping
			// sur le scope 'profile' (ou un scope personnalise si necessaire)
			scope: 'openid profile email'
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
					// Authentik fournit toujours l e-mail
					const email =
						typeof profile.email === 'string' && profile.email.trim().length > 0
							? profile.email
							: `${userId}@emse.fr`;

					// Authentik expose l annee de promo via le claim 'promo'
					const promoRaw = (profile as Record<string, unknown>).promo;
					const promoYear =
						typeof promoRaw === 'number'
							? promoRaw
							: typeof promoRaw === 'string' && promoRaw.trim().length > 0
								? parseInt(promoRaw, 10) || null
								: null;

					createUser({
						id_user: userId,
						email,
						prenom: (profile.given_name as string) || userId,
						nom: (profile.family_name as string) || '',
						// Authentik fournit toutes les infos : first_login = 0 directement
						first_login: 0,
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
					// Stocker la promo dans le JWT
					const promoRaw = (profile as Record<string, unknown>).promo;
					token.promo_year =
						typeof promoRaw === 'number'
							? promoRaw
							: typeof promoRaw === 'string' && promoRaw.trim().length > 0
								? parseInt(promoRaw, 10) || null
								: null;
				}
			}
			return token;
		},

		session({ session, token }: { session: Session; token: JWT }): Session {
			if (token && session.user) {
				session.user.id = token.id as string;
				session.user.email = token.email as string;
				session.user.name = token.name as string;
			}
			return session;
		}
	}
});
