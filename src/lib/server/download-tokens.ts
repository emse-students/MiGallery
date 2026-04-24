interface DownloadToken {
	assetIds: string[];
	filename: string;
	expiresAt: number;
}

const store = new Map<string, DownloadToken>();

// Purge expired tokens every minute
setInterval(() => {
	const now = Date.now();
	for (const [token, data] of store) {
		if (data.expiresAt < now) {
			store.delete(token);
		}
	}
}, 60_000);

export function createDownloadToken(assetIds: string[], filename: string): string {
	const token = crypto.randomUUID();
	store.set(token, { assetIds, filename, expiresAt: Date.now() + 5 * 60 * 1000 });
	return token;
}

export function consumeDownloadToken(token: string): DownloadToken | null {
	const data = store.get(token);
	if (!data || Date.now() > data.expiresAt) {
		return null;
	}
	store.delete(token); // one-time use
	return data;
}
