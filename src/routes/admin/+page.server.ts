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

	// Read docs directory
	const docsDir = join(process.cwd(), 'docs');
	let files: { name: string; filename: string; html: string }[] = [];
	try {
		const entries = readdirSync(docsDir).filter((f) => f.endsWith('.md'));
		for (const fn of entries) {
			try {
				const raw = readFileSync(join(docsDir, fn), 'utf-8');
				// Extract title from first heading if present
				const titleMatch = raw.match(/^#\s*(.+)$/m);
				const title = titleMatch ? titleMatch[1].trim() : fn.replace(/[-_]/g, ' ').replace(/\.md$/, '');
				const html = mdToHtml(raw);
				files.push({ name: title, filename: fn, html });
			} catch (_e) {
				void _e;
				// ignore individual file read errors
			}
		}
	} catch (_e) {
		void _e;
		// docs directory missing - return empty
		files = [];
	}

	// Prefer showing API_ENDPOINTS.md first if present
	files.sort((a, _b) =>
		a.filename.toLowerCase() === 'api_endpoints.md' || a.filename.toLowerCase() === 'api-endpoints.md'
			? -1
			: 0
	);

	return { docs: files };
};
