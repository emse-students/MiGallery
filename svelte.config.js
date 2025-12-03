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
		// Configuration CSRF : désactiver pour les routes /api/external/* qui utilisent x-api-key
		csrf: {
			checkOrigin: true // Actif par défaut, mais on va l'overrider au niveau des routes
		}
	},
	compilerOptions: {
		runes: true
	}
};

export default config;
