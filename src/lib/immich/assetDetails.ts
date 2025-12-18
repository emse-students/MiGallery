import type { ImmichAsset } from '$lib/types/api';

const memoryCache = new Map<string, ImmichAsset>();
const inflight = new Map<string, Promise<ImmichAsset | null>>();

function readStorage(key: string): ImmichAsset | null {
	try {
		if (typeof window === 'undefined') {
			return null;
		}
		const v = sessionStorage.getItem(key);
		return v ? (JSON.parse(v) as ImmichAsset) : null;
	} catch {
		return null;
	}
}

function writeStorage(key: string, value: ImmichAsset): void {
	try {
		if (typeof window === 'undefined') {
			return;
		}
		sessionStorage.setItem(key, JSON.stringify(value));
	} catch {
		void 0;
	}
}

export async function fetchAssetDetail(id: string): Promise<ImmichAsset | null> {
	if (!id) {
		return null;
	}
	if (memoryCache.has(id)) {
		return memoryCache.get(id) ?? null;
	}

	const storageKey = `asset:${id}`;
	const fromStorage = readStorage(storageKey);
	if (fromStorage) {
		memoryCache.set(id, fromStorage);
		return fromStorage;
	}

	if (inflight.has(id)) {
		return inflight.get(id) ?? null;
	}

	const p = (async (): Promise<ImmichAsset | null> => {
		try {
			const res = await fetch(`/api/immich/assets/${id}`);
			if (!res.ok) {
				return null;
			}
			const json = (await res.json()) as ImmichAsset;
			memoryCache.set(id, json);
			writeStorage(storageKey, json);
			return json;
		} catch (_e) {
			void _e;
			return null;
		} finally {
			inflight.delete(id);
		}
	})();

	inflight.set(id, p);
	return p;
}

export async function fetchAssetsDetails(
	ids: string[],
	concurrency = 8
): Promise<Array<ImmichAsset | null>> {
	if (!Array.isArray(ids)) {
		return [];
	}
	const out: Array<ImmichAsset | null> = new Array<ImmichAsset | null>(ids.length).fill(null);

	let idx = 0;

	async function worker(): Promise<void> {
		while (true) {
			const i = idx++;
			if (i >= ids.length) {
				break;
			}
			const id = ids[i];
			const detail = await fetchAssetDetail(id);
			out[i] = detail ?? null;
		}
	}

	const workers: Promise<void>[] = [];
	const w = Math.max(1, Math.min(concurrency, ids.length));
	for (let i = 0; i < w; i++) {
		workers.push(worker());
	}
	await Promise.all(workers);
	return out;
}

export function clearAssetCaches() {
	memoryCache.clear();
	try {
		if (typeof window !== 'undefined') {
			sessionStorage.clear();
		}
	} catch {
		void 0;
	}
}
