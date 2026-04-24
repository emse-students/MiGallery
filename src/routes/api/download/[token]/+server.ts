import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { consumeDownloadToken } from '$lib/server/download-tokens';
import { env } from '$env/dynamic/private';
import { ensureError } from '$lib/ts-utils';

const IMMICH_BASE_URL = env.IMMICH_BASE_URL;
const IMMICH_API_KEY = env.IMMICH_API_KEY ?? '';

export const GET: RequestHandler = async (event) => {
	const { token } = event.params;
	const data = consumeDownloadToken(token);

	if (!data) {
		throw error(404, 'Token de téléchargement invalide ou expiré');
	}

	if (!IMMICH_BASE_URL) {
		throw error(500, 'IMMICH_BASE_URL not configured');
	}

	try {
		const res = await fetch(`${IMMICH_BASE_URL}/api/download/archive`, {
			method: 'POST',
			headers: {
				'x-api-key': IMMICH_API_KEY,
				'Content-Type': 'application/json',
				Accept: 'application/zip, application/octet-stream'
			},
			body: JSON.stringify({ assetIds: data.assetIds })
		});

		if (!res.ok) {
			const text = await res.text().catch(() => '');
			throw error(res.status, `Échec de la récupération de l'archive : ${text.slice(0, 200)}`);
		}

		const filename = encodeURIComponent(`${data.filename}.zip`);
		const headers = new Headers({
			'Content-Type': 'application/zip',
			'Content-Disposition': `attachment; filename*=UTF-8''${filename}`
		});
		const contentLength = res.headers.get('content-length');
		if (contentLength) {
			headers.set('Content-Length', contentLength);
		}

		// Stream directly from Immich to the browser — no JS buffering, no service worker
		return new Response(res.body, { headers });
	} catch (e: unknown) {
		const err = ensureError(e);
		if (e && typeof e === 'object' && 'status' in e) {
			throw e;
		}
		throw error(500, err.message);
	}
};
