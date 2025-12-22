import { SvelteKitAuth } from '@auth/sveltekit';
import { env } from '$env/dynamic/private';
import type { JWT } from '@auth/core/jwt';
import type { Session, User, Profile } from '@auth/core/types';

export const { handle } = SvelteKitAuth({
	providers: [
		{
			id: 'cas-emse', // signIn("my-provider") and will be part of the callback URL
			name: 'CAS EMSE', // optional, used on the default login page as the button text.
			type: 'oidc',
			issuer: 'https://cas.emse.fr/cas/oidc', // to infer the .well-known/openid-configuration URL
			clientId: env.CAS_CLIENT_ID, // from the provider's dashboard
			clientSecret: env.CAS_CLIENT_SECRET, // from the provider's dashboard
			client: {
				token_endpoint_auth_method: 'client_secret_post'
			},
			authorization: {
				scope: 'openid profile email'
			}
		}
	],
	trustHost: env.AUTH_TRUSTED_HOST === 'true',
	secret: env.AUTH_SECRET,
	callbacks: {
		jwt({ token, user, profile }: { token: JWT; user?: User; profile?: Profile }): JWT {
			if (user) {
				token.id = profile?.sub;
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
