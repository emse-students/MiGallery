import { SvelteKitAuth } from '@auth/sveltekit';
import { env } from '$env/dynamic/private';
import type { JWT } from '@auth/core/jwt';
import type { Session } from '@auth/core/types';
import type { Provider } from '@auth/core/providers';
import { getUserByCasId, createUser } from '$lib/db/users';

const providers: Provider[] = [
	{
		id: 'cas-emse',
		name: 'CAS EMSE',
		type: 'oidc',
		issuer: 'https://cas.emse.fr/cas/oidc',
		clientId: env.CAS_CLIENT_ID,
		clientSecret: env.CAS_CLIENT_SECRET,
		client: {
			token_endpoint_auth_method: 'client_secret_post'
		},
		// Utilisation de 'state' uniquement pour éviter les erreurs "InvalidCheck: pkceCodeVerifier"
		// en cas de doubles requêtes ou problèmes de cookies inter-domaines.
		checks: ['state'],
		authorization: {
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

			// 1. Authentification CAS (Etudiants)
			if (account.provider === 'cas-emse') {
				const casId = profile.sub!;
				const existingUser = getUserByCasId(casId);

				if (!existingUser) {
					const emailCandidate = profile.email;
					// Assure que l'email est une string non-vide, sinon fallback
					const email =
						typeof emailCandidate === 'string' && emailCandidate.trim().length > 0
							? emailCandidate
							: `${casId}@etu.emse.fr`;

					console.warn(`[auth] Creating new CAS user: ${casId} (${email})`);

					// Création automatique si l'utilisateur n'existe pas
					createUser({
						id_user: casId,
						email,
						prenom: (profile.given_name as string) || casId,
						nom: (profile.family_name as string) || '',
						first_login: 1,
						role: 'user',
						promo_year: null
					});
				}
				return true;
			}

			return false;
		},

		jwt({ token, account, profile }): JWT {
			// Lors de la connexion (première fois)
			if (account && profile) {
				if (account.provider === 'cas-emse') {
					token.id = profile.sub;
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
