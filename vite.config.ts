import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { paraglideVitePlugin } from '@inlang/paraglide-js';

export default defineConfig({
	plugins: [
		// Paraglide compiles the message runtime into src/lib/paraglide before
		// SvelteKit. MiGallery is server-rendered (adapter-node), so locale
		// detection is server-driven: the cookie set by the language switcher, then
		// the browser Accept-Language header, then the base locale (fr). The server
		// middleware in hooks.server.ts binds the resolved locale during SSR.
		paraglideVitePlugin({
			project: './project.inlang',
			outdir: './src/lib/paraglide',
			strategy: ['cookie', 'preferredLanguage', 'baseLocale']
		}),
		sveltekit()
	],
	preview: {
		host: '0.0.0.0',
		port: 5173,
		allowedHosts: ['gallery.mitv.fr']
	}
});
