import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireScope } from '$lib/server/permissions';
import { generateFaceCrop } from '$lib/server/face-crop';

/**
 * GET /api/faces/[assetId]/[personId]
 * Returns a square WebP cropped and centered on the given person's face in the
 * asset (see $lib/server/face-crop). Pass "center" as personId to force a plain
 * center crop. Shared crop logic + on-disk cache live in face-crop.ts so the
 * avatar endpoint serves the exact same image.
 */
export const GET: RequestHandler = async (event) => {
	await requireScope(event, 'read');
	const { assetId, personId } = event.params;

	if (!assetId) {
		throw error(400, 'Missing assetId');
	}

	const result = await generateFaceCrop(assetId, personId || 'center', event.fetch);

	if (result.ok) {
		return new Response(new Uint8Array(result.buffer), {
			headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=15552000' }
		});
	}

	if (result.reason === 'busy') {
		// Queue full: fall back to the proxied thumbnail (still an image, just not
		// face-cropped) rather than load an image in RAM and risk OOM under burst.
		return new Response(null, {
			status: 307,
			headers: {
				Location: `/api/immich/assets/${assetId}/thumbnail?size=thumbnail`,
				'Cache-Control': 'no-store'
			}
		});
	}

	if (result.reason === 'notfound') {
		throw error(404, 'Image source not found');
	}

	throw error(500, 'Internal Server Error');
};
