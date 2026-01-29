import { SvelteKitAuth } from '@auth/sveltekit';
import { env } from '$env/dynamic/private';
import type { JWT } from '@auth/core/jwt';
import type { Session } from '@auth/core/types';
import type { Provider } from '@auth/core/providers';
import {
	getUserByCasId,
	getUserByAlumniId,
	createUser,
	linkAlumniToUser,
	findUserByIdentity
} from '$lib/db/users';

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
		authorization: {
			scope: 'openid profile email'
		}
	}
];

if (env.ALUMNI_ISSUER && env.ALUMNI_CLIENT_ID && env.ALUMNI_CLIENT_SECRET) {
	providers.push({
		id: 'mines-alumni',
		name: 'Mines Alumnis',
		type: 'oidc',
		issuer: env.ALUMNI_ISSUER,
		clientId: env.ALUMNI_CLIENT_ID,
		clientSecret: env.ALUMNI_CLIENT_SECRET,
		client: {
			token_endpoint_auth_method: 'client_secret_post'
		},
		authorization: {
			scope: 'openid profile email'
		}
	});
}

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
						promo_year: null,
						alumni_id: null
					});
				}
				return true;
			}

			// 2. Authentification Alumni
			if (account.provider === 'mines-alumni') {
				const alumniId = profile.sub!;
				const existingLinkedUser = getUserByAlumniId(alumniId);

				// Cas 2a: Utilisateur déjà connu (lié) -> OK
				if (existingLinkedUser) {
					return true;
				}

				// Cas 2b: Tentative de liaison automatique
				// On essaie de trouver un user CAS correspondant (Nom + Prénom + Promo)
				const promo = (profile.promotion as number) || (profile.promo as number) || undefined;

				if (profile.given_name && profile.family_name && promo) {
					const candidate = findUserByIdentity(
						profile.given_name as string,
						profile.family_name as string,
						promo
					);

					if (candidate) {
						// Match trouvé ! On lie le compte.
						linkAlumniToUser(candidate.id_user, alumniId);
						return true;
					}
				}

				// Cas 2c: Nouvel utilisateur Alumni pur (jamais connecté au site via CAS avant)
				// On crée un nouveau compte.
				// Attention: ID collision. On préfixe pour éviter conflits avec login CAS.
				const emailCandidate = profile.email;
				const email =
					typeof emailCandidate === 'string' && emailCandidate.trim().length > 0
						? emailCandidate
						: `${alumniId}@alumni.emse.fr`; // Fallback fictif pour éviter NOT NULL

				console.warn(`[auth] Creating new Alumni user: ${alumniId} (${email})`);

				createUser({
					id_user: `alumni_${alumniId}`,
					alumni_id: alumniId,
					email,
					prenom: (profile.given_name as string) || 'Alumni',
					nom: (profile.family_name as string) || 'Inconnu',
					first_login: 1,
					role: 'user',
					promo_year: promo || null
				});
				return true;
			}

			return false;
		},

		jwt({ token, account, profile }): JWT {
			// Lors de la connexion (première fois)
			if (account && profile) {
				if (account.provider === 'cas-emse') {
					token.id = profile.sub;
				} else if (account.provider === 'mines-alumni') {
					// Important: Il faut récupérer l'ID interne (CAS ou alumni_...)
					// car profile.sub est l'ID Alumni ici.
					const dbUser = getUserByAlumniId(profile.sub!);
					token.id = dbUser ? dbUser.id_user : `alumni_${profile.sub}`;
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
