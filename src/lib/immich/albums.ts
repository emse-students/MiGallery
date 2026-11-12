/**
 * Pin an asset as the album cover. Goes through our own endpoint, not the
 * media backend directly, so the choice is persisted locally and the image of
 * the cover it replaces is pruned from disk.
 */
export async function setAlbumCover(albumId: string, assetId: string): Promise<void> {
  const res = await fetch(`/api/albums/${albumId}/cover`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assetId }),
  });
  if (!res.ok) {
    throw new Error(await res.text().catch(() => res.statusText));
  }
}
