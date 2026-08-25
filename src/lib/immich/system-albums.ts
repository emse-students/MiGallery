import { env } from '$env/dynamic/private';
import type { ImmichAlbum } from '$lib/types/api';
import { OUTBOUND_BUDGET_MS } from '$lib/server/outbound';
const IMMICH_BASE_URL = env.IMMICH_BASE_URL;
const IMMICH_API_KEY = env.IMMICH_API_KEY ?? '';

const albumIdCache: Record<string, { id: string; updatedAt: number }> = {};
const ALBUM_CACHE_TTL = 60 * 1000; // 1 minute

async function fetchAlbums(fetchFn: typeof fetch): Promise<ImmichAlbum[]> {
	if (!IMMICH_BASE_URL) {
		throw new Error('IMMICH_BASE_URL not configured');
	}
	const res = await fetchFn(`${IMMICH_BASE_URL}/api/albums`, {
		signal: AbortSignal.timeout(OUTBOUND_BUDGET_MS),
		headers: {
			'x-api-key': IMMICH_API_KEY,
			Accept: 'application/json'
		}
	});
	if (!res.ok) {
		throw new Error(`Failed to fetch albums: ${res.statusText}`);
	}
	return (await res.json()) as ImmichAlbum[];
}

export async function getOrCreateSystemAlbum(
	fetchFn: typeof fetch,
	albumName: string
): Promise<string> {
	if (albumIdCache[albumName] && Date.now() - albumIdCache[albumName].updatedAt < ALBUM_CACHE_TTL) {
		return albumIdCache[albumName].id;
	}

	const albums = await fetchAlbums(fetchFn);
	const existing = albums.find((a) => a.albumName === albumName);
	if (existing) {
		albumIdCache[albumName] = { id: existing.id, updatedAt: Date.now() };
		return existing.id;
	}

	const createRes = await fetchFn(`${IMMICH_BASE_URL}/api/albums`, {
		signal: AbortSignal.timeout(OUTBOUND_BUDGET_MS),
		method: 'POST',
		headers: {
			'x-api-key': IMMICH_API_KEY,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({ albumName, description: `System album ${albumName}` })
	});

	if (!createRes.ok) {
		const txt = await createRes.text().catch(() => createRes.statusText);
		throw new Error(`Failed to create album ${albumName}: ${txt}`);
	}

	const newAlbum = (await createRes.json()) as ImmichAlbum;
	albumIdCache[albumName] = { id: newAlbum.id, updatedAt: Date.now() };
	return newAlbum.id;
}
