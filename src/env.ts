import { defineEnvVars } from '@sveltejs/kit/env';

/**
 * Optional string: unset stays `undefined`, exactly what `$env/dynamic/private` handed out. Each
 * consumer already decides what an absent value means (the Immich proxy answers 503, a missing
 * OIDC issuer fails the login), and the test suite runs with no Immich at all, so none of these
 * may stop the server from starting.
 */
const optional = (description: string) => ({
  description,
  schema: (value: string | undefined) => value,
});

/**
 * Every variable the SvelteKit layer reads. Kit 3 exposes ONLY what is declared here: the
 * deprecated `$env/dynamic/private` is now a view of this very list, so an undeclared variable
 * reads as `undefined` with no error. A variable added to the code must be added here.
 * `DATABASE_PATH`, `PORT`, `BACKUP_DIR`... are read through `process.env` by the database layer
 * and the adapter, outside SvelteKit, and are not listed.
 */
export const variables = defineEnvVars({
  IMMICH_BASE_URL: optional('Base URL of the Immich API (empty: Immich is not configured)'),
  IMMICH_API_KEY: optional('Immich API key, injected server-side by the proxy'),
  MICONNECT_ISSUER: optional('Authentik issuer, ".../application/o/<slug>"'),
  MICONNECT_CLIENT_ID: optional('OIDC client id'),
  MICONNECT_CLIENT_SECRET: optional('OIDC client secret'),
  AVATAR_SIGNING_KEY: optional('HMAC key of the signed avatar URLs'),
  FACE_STORE_KEY: optional(
    'Face store sealing key, 64 hex characters (src/lib/server/face-seal.ts)'
  ),
  FACE_ML_URL: optional('Base URL of the face model service (Immich machine learning)'),
});
