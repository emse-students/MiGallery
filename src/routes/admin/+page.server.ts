import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { mdToHtml } from '$lib/docs/render-md';
import { ensureAdmin } from '$lib/server/auth';

export const load: PageServerLoad = async ({ locals, cookies }) => {
	const admin = await ensureAdmin({ locals, cookies });
	if (!admin) {
		throw redirect(303, '/');
	}

	const docsDir = join(process.cwd(), 'docs', 'wiki');
	let files: { name: string; filename: string; html: string }[] = [];
	try {
		const entries = readdirSync(docsDir).filter((f) => f.endsWith('.md'));
		for (const fn of entries) {
			try {
				const raw = readFileSync(join(docsDir, fn), 'utf-8');
				const titleMatch = raw.match(/^#\s*(.+)$/m);
				const title = titleMatch ? titleMatch[1].trim() : fn.replace(/[-_]/g, ' ').replace(/\.md$/, '');
				const html = mdToHtml(raw);
				files.push({ name: title, filename: fn, html });
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
