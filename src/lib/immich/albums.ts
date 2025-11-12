export async function getAlbum(immichId: string | null) {
	if (!immichId) throw new Error('No album id');
	const res = await fetch(`/api/immich/albums/${immichId}`);
	if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
	const data = await res.json();
	const albumName = data?.albumName || null;
	const list: any[] = Array.isArray(data?.assets) ? data.assets : [];
	const assets = list.filter((a: any) => !!a.id);
	return { albumName, assets };
}

export async function fetchAlbumCovers(albums: { id: string }[], batchSize = 5) {
	const albumCovers: Record<string, { id: string; type?: string }> = {};
	for (let i = 0; i < albums.length; i += batchSize) {
		const batch = albums.slice(i, i + batchSize);
		await Promise.all(batch.map(async (album) => {
			try {
				const res = await fetch(`/api/immich/albums/${album.id}`);
				if (res.ok) {
					const data = await res.json();
					const assets = Array.isArray(data?.assets) ? data.assets : [];
					if (assets.length > 0) {
						albumCovers[album.id] = { id: assets[0].id, type: assets[0].type };
					}
				}
			} catch (e) {
				// ignore per-album failures
			}
		}));
	}
	return albumCovers;
}
