import { SvelteKitAuth } from "@auth/sveltekit";
import "dotenv/config";


export const { handle } = SvelteKitAuth({
	providers: [
    {
      id: "cas-emse",
      name: "CAS EMSE",
      type: 'oidc',
      issuer: "https://cas.emse.fr/cas/oidc",
      clientId: process.env.CAS_CLIENT_ID,
      clientSecret: process.env.CAS_CLIENT_SECRET,
      authorization: {
        scope: 'openid profile email'
      }
    }
  ]
});
