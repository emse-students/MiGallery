import adapterNode from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  // Consult https://svelte.dev/docs/kit/integrations
  // for more information about preprocessors
  // `style: false`: no component style uses a preprocessor language, and preprocessing them
  // handed each raw <style> block to lightningcss BEFORE Svelte compiled it, so every
  // `:global(...)` was reported as an unknown pseudo-class on every dev start. Svelte's
  // compiled CSS still goes through vite's lightningcss afterwards, targets included.
  preprocess: vitePreprocess({ script: true, style: false }),

  kit: {
    // adapter-auto only supports some environments, see https://svelte.dev/docs/kit/adapter-auto for a list.
    // If your environment is not supported, or you settled on a specific environment, switch out the adapter.
    // See https://svelte.dev/docs/kit/adapters for more information about adapters.
    adapter: adapterNode(),
    prerender: {
      handleHttpError: 'warn',
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
        'http://localhost:5174',
      ],
    },
    version: {
      pollInterval: 60000,
    },
  },
};

export default config;
