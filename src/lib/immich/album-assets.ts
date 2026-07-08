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
	const inline = Array.isArray(album?.assets) ? album.assets : [];
	if (inline.length > 0) {
		return inline;
	}

	// Immich v3 no longer inlines the assets in the album detail, so fall back to
	// the metadata search - and PAGINATE it: a single page is capped at `size`
	// (1000), which silently truncated large albums (e.g. PhotoCV) and broke the
	// "Mes photos CV" intersection.
	const base = baseUrl.replace(/\/$/, '');
	const all: ImmichAlbumAssetLike[] = [];
	let page = 1;
	while (page <= 50) {
		const searchRes = await fetchFn(`${base}/api/search/metadata`, {
			method: 'POST',
			headers: {
				'x-api-key': apiKey,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({ albumIds: [albumId], page, size: 1000 })
		});

		if (!searchRes.ok) {
			break;
		}

		const searchData = (await searchRes.json()) as {
			assets?: {
				items?: ImmichAlbumAssetLike[];
				nextPage?: number | string | null;
			};
		};
		const items = Array.isArray(searchData?.assets?.items) ? searchData.assets.items : [];
		if (items.length === 0) {
			break;
		}
		all.push(...items);

		const nextPage = searchData.assets?.nextPage;
		if (nextPage === null || nextPage === undefined) {
			break;
		}
		page++;
	}
	return all;
}
