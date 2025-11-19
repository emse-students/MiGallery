import { SvelteKitAuth } from "@auth/sveltekit";
import { env } from '$env/dynamic/private';

export const { handle } = SvelteKitAuth({
	providers: [
		{
			id: "cas-emse", // signIn("my-provider") and will be part of the callback URL
			name: "CAS EMSE", // optional, used on the default login page as the button text.
			type: "oidc", // or "oauth" for OAuth 2 providers
			issuer: "https://cas.emse.fr/cas/oidc", // to infer the .well-known/openid-configuration URL
			clientId: env.CAS_CLIENT_ID, // from the provider's dashboard
			clientSecret: env.CAS_CLIENT_SECRET, // from the provider's dashboard
			authorization: {
				scope: "openid profile email",
			},
			
		},
	],
	trustHost: env.AUTH_TRUSTED_HOST === 'true',
	secret: env.AUTH_SECRET,
	callbacks: {
		async jwt({ token, user, profile }) {
			// Initial sign in

			if (user) {
				token.id = profile?.sub;

			}
			return token;
		},
		async session({ session, token }) {
			if (token) {
				session.user.id = token.id as string;
				session.user.email = token.email as string;
				session.user.name = token.name as string;
			}
			return session;
		}
	}
});
