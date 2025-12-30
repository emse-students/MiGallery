import adapterBun from 'svelte-adapter-bun';
import adapterNode from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const useNodeAdapter = process.env.ADAPTER === 'node';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://svelte.dev/docs/kit/integrations
	// for more information about preprocessors
	preprocess: vitePreprocess(),

	kit: {
		// adapter-auto only supports some environments, see https://svelte.dev/docs/kit/adapter-auto for a list.
		// If your environment is not supported, or you settled on a specific environment, switch out the adapter.
		// See https://svelte.dev/docs/kit/adapters for more information about adapters.
		adapter: useNodeAdapter ? adapterNode() : adapterBun(),
		prerender: {
			handleHttpError: 'warn'
		},
		// Configuration CSRF : on spécifie les origines de confiance.
		// Les routes /api/external/* utilisent x-api-key (pas de cookies), donc pas de risque CSRF.
		// Les autres routes mutantes (POST/PUT/DELETE) sont vérifiées dans hooks.server.ts.
		csrf: {
			trustedOrigins: [
				'https://portail-etu.emse.fr',
				'https://gallery.mitv.fr',
				'http://localhost:5173',
				'http://localhost:3000',
				'http://localhost:5174'
			]
		},
		version: {
			pollInterval: 60000
		}
	},
	compilerOptions: {
		runes: true
	}
};

export default config;
