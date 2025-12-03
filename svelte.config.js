import adapter from 'svelte-adapter-bun';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://svelte.dev/docs/kit/integrations
	// for more information about preprocessors
	preprocess: vitePreprocess(),

	kit: {
		// adapter-auto only supports some environments, see https://svelte.dev/docs/kit/adapter-auto for a list.
		// If your environment is not supported, or you settled on a specific environment, switch out the adapter.
		// See https://svelte.dev/docs/kit/adapters for more information about adapters.
		adapter: adapter(),
		prerender: {
			handleHttpError: 'warn'
		},
		// Configuration CSRF : désactivé globalement car on gère nous-mêmes la sécurité
		// dans hooks.server.ts. Les routes /api/external/* utilisent x-api-key (pas de cookies),
		// donc pas de risque CSRF. Les autres routes sont protégées par notre hook.
		csrf: {
			checkOrigin: false
		}
	},
	compilerOptions: {
		runes: true
	}
};

export default config;
