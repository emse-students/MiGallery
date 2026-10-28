import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-bun';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { defineConfig, type Plugin } from 'vite';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import tailwindcss from '@tailwindcss/vite';
import browserslist from 'browserslist';
import { browserslistToTargets } from 'lightningcss';
import pkg from './package.json' with { type: 'json' };

/** Route modules that exist only under `vite dev` and in the `--mode test` build. */
const DEV_ONLY_ROUTES = ['/src/routes/dev/login-as/+server.ts'];

/**
 * Builds every other mode with each DEV_ONLY_ROUTES module replaced by a bare 404, so the code is
 * not in the bundle at all - a build-time decision no environment variable can reverse. SvelteKit
 * has no per-route exclusion, so the module is swapped at `load`, before anything compiles it.
 * CI's "The production build carries no dev login" step checks the result.
 */
function devOnlyRoutes(): Plugin {
  let keep = false;
  return {
    name: 'migallery:dev-only-routes',
    enforce: 'pre',
    configResolved(config) {
      keep = config.command === 'serve' || config.mode === 'test';
    },
    load(id) {
      if (keep) return null;
      const path = id.replaceAll('\\', '/');
      if (DEV_ONLY_ROUTES.some((route) => path.endsWith(route))) {
        return "export const GET = () => new Response('Not found', { status: 404 });";
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [
    devOnlyRoutes(),
    // Paraglide compiles the message runtime into src/lib/paraglide before
    // SvelteKit. MiGallery is server-rendered (adapter-bun), so locale
    // detection is server-driven: the cookie set by the language switcher, then
    // the browser Accept-Language header, then the base locale (fr). The server
    // middleware in hooks.server.ts binds the resolved locale during SSR.
    paraglideVitePlugin({
      project: './project.inlang',
      outdir: './src/lib/paraglide',
      strategy: ['cookie', 'preferredLanguage', 'baseLocale'],
    }),
    // Tailwind runs as a Vite plugin, not through PostCSS. The PostCSS wrapper is the
    // path Tailwind keeps for build tools that are not Vite; here it only added a
    // second CSS pass over every file.
    tailwindcss(),
    sveltekit({
      adapter: adapter(),
      // `style: false`: no component style uses a preprocessor language, and preprocessing them
      // handed each raw <style> block to lightningcss BEFORE Svelte compiled it, so every
      // `:global(...)` was reported as an unknown pseudo-class on every dev start. Svelte's
      // compiled CSS still goes through vite's lightningcss afterwards, targets included.
      preprocess: vitePreprocess({ script: true, style: false }),
      prerender: {
        handleHttpError: 'warn',
      },
      // NO `paths.origin`: it is baked at BUILD time and rewrites every request onto one host, so
      // a dev, preview or local build would send its OIDC redirect_uri and OG URLs to production.
      // adapter-bun derives the origin from the request's Host header (https assumed), so the
      // proxy or tunnel in front MUST forward the public Host unchanged (docs/wiki/deployment.md).
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
    }),
  ],
  // VENDOR PREFIXES. Dropping PostCSS drops autoprefixer with it, and that was NOT
  // cosmetic: the source writes `backdrop-filter` 50 times and `-webkit-backdrop-filter`
  // only 5, so 40 of the 45 prefixed declarations in the built CSS were autoprefixer's -
  // every glass surface in the app would have lost its blur on Safari and iOS, silently,
  // with a green build. Lightning CSS takes over the job for Tailwind's output AND for the
  // hand-written `<style>` blocks, driven by the same browserslist query.
  css: {
    transformer: 'lightningcss',
    lightningcss: {
      targets: browserslistToTargets(
        browserslist('>= 0.5%, last 2 versions, Firefox ESR, not dead')
      ),
    },
  },
  build: { cssMinify: 'lightningcss' },
  // The RELEASE version shown in the admin panel. Not kit.version.name: that one
  // must change on every build so clients notice a deploy.
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },

  preview: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: ['gallery.mitv.fr'],
  },
});
