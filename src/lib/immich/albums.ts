import type { ImmichAlbum } from '$lib/types/api';

export async function getAlbum(immichId: string | null): Promise<{
	albumName: string | null;
	assets: Array<{ id: string }>;
}> {
	if (!immichId) {
		throw new Error('No album id');
	}
	const res = await fetch(`/api/immich/albums/${immichId}`);
	if (!res.ok) {
		throw new Error(await res.text().catch(() => res.statusText));
	}
	const data = (await res.json()) as ImmichAlbum;
	const albumName = data?.albumName || null;
	const list: Array<{ id: string }> = Array.isArray(data?.assets) ? data.assets : [];
	const assets = list.filter((a) => !!a.id);
	return { albumName, assets };
}

/**
 * Pin an asset as the album cover. Goes through our own endpoint, not the
 * media backend directly, so the choice is persisted locally and the image of
 * the cover it replaces is pruned from disk.
 */
export async function setAlbumCover(albumId: string, assetId: string): Promise<void> {
	const res = await fetch(`/api/albums/${albumId}/cover`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ assetId })
	});
	if (!res.ok) {
		throw new Error(await res.text().catch(() => res.statusText));
	}
}
