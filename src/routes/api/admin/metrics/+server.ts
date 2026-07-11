import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireScope } from '$lib/server/permissions';

/**
 * GET /api/admin/metrics
 * Runtime health for the admin dashboard: process memory (the OOM safety net
 * from the Bun->Node migration) and uptime.
 * Admin scope only (session admin or admin API key).
 */
export const GET: RequestHandler = async (event) => {
	await requireScope(event, 'admin');

	const mem = process.memoryUsage();

	return json({
		success: true,
		timestamp: Date.now(),
		process: {
			uptimeSeconds: Math.round(process.uptime()),
			pid: process.pid,
			nodeVersion: process.version,
			// All values in bytes; the UI formats them.
			memory: {
				rss: mem.rss,
				heapTotal: mem.heapTotal,
				heapUsed: mem.heapUsed,
				external: mem.external,
				arrayBuffers: mem.arrayBuffers
			}
		}
	});
};
