const IMMICH_BASE_URL = (typeof process !== 'undefined' && process.env?.IMMICH_BASE_URL) || '';
const IMMICH_API_KEY = (typeof process !== 'undefined' && process.env?.IMMICH_API_KEY) || '';

export interface ImmichAlbumAssetLike {
	id: string;
	[type: string]: unknown;
}

export interface ImmichAlbumPayload {
	id?: string;
	albumName?: string;
	assets?: ImmichAlbumAssetLike[];
	assetCount?: number;
	[key: string]: unknown;
}

export async function fetchAlbumAssets(
	fetchFn: typeof fetch,
	baseUrl: string = IMMICH_BASE_URL,
	apiKey: string = IMMICH_API_KEY,
	albumId: string
): Promise<ImmichAlbumAssetLike[]> {
	if (!baseUrl || !albumId) {
		return [];
	}

	const albumRes = await fetchFn(`${baseUrl.replace(/\/$/, '')}/api/albums/${albumId}`, {
		headers: {
			'x-api-key': apiKey,
			Accept: 'application/json'
		}
	});

	if (!albumRes.ok) {
		throw new Error(`Failed to fetch album: ${albumRes.status} ${albumRes.statusText}`);
	}

	const album = (await albumRes.json()) as ImmichAlbumPayload;
	const assets = Array.isArray(album?.assets) ? album.assets : [];
	if (assets.length > 0) {
		return assets;
	}

	const searchRes = await fetchFn(`${baseUrl.replace(/\/$/, '')}/api/search/metadata`, {
		method: 'POST',
		headers: {
			'x-api-key': apiKey,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({ albumIds: [albumId], type: 'IMAGE', page: 1, size: 1000 })
	});

	if (!searchRes.ok) {
		return [];
	}

	const searchData = (await searchRes.json()) as {
		assets?: {
			items?: ImmichAlbumAssetLike[];
		};
	};
	return Array.isArray(searchData?.assets?.items) ? searchData.assets.items : [];
}
