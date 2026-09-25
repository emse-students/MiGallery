/**
 * Handing ORIGINAL files to the system share sheet (Web Share level 2), as Google Photos does.
 *
 * The ONE implementation, used by the viewer's Share (`PhotoModal.svelte`) and the grid's
 * selection Share (`PhotosGrid.svelte`) - see `docs/wiki/viewer.md`. Browser-only: every
 * function here touches `navigator` or `fetch` and is called from an event handler or `onMount`.
 */
import type { Asset } from '$lib/photos.svelte';
import { toast } from '$lib/toast';
import { m } from '$lib/paraglide/messages';

/** Where the originals come from: an unlisted album's visitor goes through the album's route. */
export interface OriginalSource {
  albumVisibility?: string;
  albumId?: string;
}

/** The original's URL for one asset. */
export function originalUrl(id: string, source: OriginalSource = {}): string {
  return source.albumVisibility === 'unlisted' && source.albumId
    ? `/api/albums/${source.albumId}/asset-original/${id}`
    : `/api/immich/assets/${id}/original`;
}

/** The name a downloaded or shared original carries. */
export function originalFileName(asset: Asset): string {
  return asset.originalFileName || `photo-${asset.id}.jpg`;
}

/** Fetches one original as a blob; throws with the HTTP status on a refusal. */
export async function fetchOriginal(id: string, source: OriginalSource = {}): Promise<Blob> {
  const res = await fetch(originalUrl(id, source));
  if (!res.ok) throw new Error(res.statusText || String(res.status));
  return res.blob();
}

/**
 * Whether this browser can hand a photo FILE to the share sheet. Probed with an empty JPEG:
 * where it answers false, no Share action is drawn at all.
 */
export function probeFileSharing(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [new File([''], 'probe.jpg', { type: 'image/jpeg' })] })
  );
}

/**
 * Shares originals, keeping what it fetched across one failure.
 *
 * `navigator.share` needs a live user activation (about 5 s in Chrome), and fetching large
 * originals on a lossy uplink can outlast it: the browser then refuses with `NotAllowedError`.
 * The fetched files are kept under the share's key, and the toast asks for a second tap, which
 * shares them at once instead of downloading them again.
 */
export class FileSharer {
  #prepared: { key: string; files: File[] } | null = null;

  /**
   * Shares `assets` (their originals, in order). `logTag` names the caller in the console.
   * Never throws: every outcome is logged, and the ones the user must know about are toasted.
   */
  async share(assets: readonly Asset[], source: OriginalSource, logTag: string): Promise<void> {
    if (assets.length === 0) return;
    const key = assets.map((a) => a.id).join(',');
    console.debug(`[${logTag}] share of ${assets.length} original(s)`);
    try {
      let files = this.#prepared?.key === key ? this.#prepared.files : null;
      if (!files) {
        files = [];
        for (const asset of assets) {
          const blob = await fetchOriginal(asset.id, source);
          files.push(new File([blob], originalFileName(asset), { type: blob.type }));
        }
        this.#prepared = { key, files };
      }
      await navigator.share({ files });
      this.#prepared = null;
    } catch (e) {
      const name = e instanceof DOMException ? e.name : '';
      if (name === 'AbortError') {
        console.debug(`[${logTag}] share dismissed by the user`);
      } else if (name === 'NotAllowedError' && this.#prepared?.key === key) {
        console.warn(`[${logTag}] share of ${key}: user activation lapsed during the fetch`);
        toast.info(m.pm_share_ready());
      } else {
        console.error(`[${logTag}] share failed for ${key}:`, e);
        toast.error(m.pm_share_error({ error: (e as Error).message }));
      }
    }
  }
}
