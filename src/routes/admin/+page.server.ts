import type { PageServerLoad } from './$types';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { mdToHtml, shortTitle, splitTitle } from '#lib/docs/render-md.ts';
import { requireAdminPage } from '#lib/server/auth.ts';

export const load: PageServerLoad = ({ locals, cookies, url }) => {
  requireAdminPage({ locals, cookies }, url);

  const docsDir = join(process.cwd(), 'docs', 'wiki');
  let files: { name: string; short: string; filename: string; html: string }[] = [];
  try {
    const entries = readdirSync(docsDir).filter((f) => f.endsWith('.md'));
    for (const fn of entries) {
      try {
        const raw = readFileSync(join(docsDir, fn), 'utf-8');
        const { title, body } = splitTitle(raw);
        const name = title ?? fn.replace(/[-_]/g, ' ').replace(/\.md$/, '');
        // The title is shown by the card header, so the rendered body does not repeat it.
        const html = mdToHtml(body);
        files.push({ name, short: shortTitle(name), filename: fn, html });
      } catch (_e) {
        void _e;
      }
    }
  } catch (_e) {
    void _e;
    files = [];
  }

  // Deterministic order: index first, then the API reference, then alphabetical.
  const rank = (fn: string) => {
    const f = fn.toLowerCase();
    if (f === 'index.md') {
      return 0;
    }
    if (f === 'api-reference.md') {
      return 1;
    }
    return 2;
  };
  files.sort((a, b) => rank(a.filename) - rank(b.filename) || a.name.localeCompare(b.name));

  return { docs: files };
};
