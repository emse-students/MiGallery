import { json } from '@sveltejs/kit';
import { ensureError } from '$lib/ts-utils';
import type { RequestHandler } from './$types';
import { requireScope } from '$lib/server/permissions';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';

import { getDatabase } from '$lib/db/database';

const execFileAsync = promisify(execFile);

export const GET: RequestHandler = async (event) => {
	await requireScope(event, 'admin');

	try {
		const scriptPath = path.join(process.cwd(), 'scripts', 'inspect-db.cjs');
		const { stdout: output } = await execFileAsync('node', [scriptPath], { encoding: 'utf-8' });

		const hasErrors = output.includes('❌') || output.includes('Erreurs détectées');
		const errors = hasErrors ? ['Voir les logs pour plus de détails'] : [];

		const db = getDatabase();
		const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {
			name: string;
		}[];

		return json({
			success: !hasErrors,
			hasErrors,
			errors,
			output,
			tables: tables.map((t) => t.name)
		});
	} catch (e: unknown) {
		const err = ensureError(e);
		const errOutput = e && typeof e === 'object' && 'stdout' in e ? String(e.stdout) : err.message;

		return json({
			success: false,
			hasErrors: true,
			errors: ['Erreurs détectées dans la base de données'],
			output: errOutput
		});
	}
};
