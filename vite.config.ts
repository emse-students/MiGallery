import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import tailwindcss from '@tailwindcss/vite';
import browserslist from 'browserslist';
import { browserslistToTargets } from 'lightningcss';

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
      strategy: ['cookie', 'preferredLanguage', 'baseLocale'],
    }),
    // Tailwind runs as a Vite plugin, not through PostCSS. The PostCSS wrapper is the
    // path Tailwind keeps for build tools that are not Vite; here it only added a
    // second CSS pass over every file.
    tailwindcss(),
    sveltekit(),
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

  preview: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: ['gallery.mitv.fr'],
  },
});
