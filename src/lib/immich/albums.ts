import type { ImmichAlbum, ImmichAsset } from '$lib/types/api';

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

export async function fetchAlbumCovers(
	albums: { id: string }[],
	batchSize = 5
): Promise<Record<string, { id: string; type?: string }>> {
	const albumCovers: Record<string, { id: string; type?: string }> = {};
	for (let i = 0; i < albums.length; i += batchSize) {
		const batch = albums.slice(i, i + batchSize);
		await Promise.all(
			batch.map(async (album) => {
				try {
					const res = await fetch(`/api/immich/albums/${album.id}`);
					if (res.ok) {
						const data = (await res.json()) as ImmichAlbum;
						const assets: ImmichAsset[] = Array.isArray(data?.assets) ? data.assets : [];
						if (assets.length > 0) {
							albumCovers[album.id] = { id: assets[0].id, type: assets[0].type };
						}
					}
				} catch (_e) {
					void _e; // Mark _e as used
					// ignore per-album failures
				}
			})
		);
	}
	return albumCovers;
}

export async function setAlbumCover(albumId: string, assetId: string): Promise<void> {
	const res = await fetch(`/api/immich/albums/${albumId}`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ albumThumbnailAssetId: assetId })
	});
	if (!res.ok) {
		throw new Error(await res.text().catch(() => res.statusText));
	}
}
