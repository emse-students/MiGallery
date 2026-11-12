import { registerShutdown } from '#lib/server/shutdown.ts';

interface DownloadToken {
  assetIds: string[];
  filename: string;
  /** Who minted it: the member's id, or null for a key. Only they redeem it. */
  mintedBy: string | null;
  expiresAt: number;
}

const store = new Map<string, DownloadToken>();

// Purge expired tokens every minute
const purgeTimer = setInterval(() => {
  const now = Date.now();
  for (const [token, data] of store) {
    if (data.expiresAt < now) {
      store.delete(token);
    }
  }
}, 60_000);
registerShutdown('download token purge', () => clearInterval(purgeTimer));

/** Mints a one-time token, valid five minutes, for `assetIds` and the caller `mintedBy`. */
export function createDownloadToken(
  assetIds: string[],
  filename: string,
  mintedBy: string | null
): string {
  const token = crypto.randomUUID();
  store.set(token, { assetIds, filename, mintedBy, expiresAt: Date.now() + 5 * 60 * 1000 });
  return token;
}

/**
 * The token's content when `redeemedBy` is the caller who minted it, and the token is spent.
 * `null` for a token that does not exist or has expired; `'other'` for a token of someone else,
 * which is left as it was for its owner.
 */
export function consumeDownloadToken(
  token: string,
  redeemedBy: string | null
): DownloadToken | 'other' | null {
  const data = store.get(token);
  if (!data || Date.now() > data.expiresAt) {
    return null;
  }
  if (data.mintedBy !== redeemedBy) {
    return 'other';
  }
  store.delete(token); // one-time use
  return data;
}
