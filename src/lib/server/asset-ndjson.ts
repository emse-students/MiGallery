import type { ImmichAsset } from '$lib/types/api';

/**
 * The fields a grid actually reads. Immich v3 search results carry `width` and
 * `height` at the top level, so the layout needs no per-asset
 * `GET /assets/{id}`: that N+1 enrichment round (one Immich call and ~2.5 KB of
 * owner/EXIF/path per photo) used to be most of an album page's weight, on a
 * lossy uplink (docs/wiki/bandwidth.md).
 */
export function slimAsset(asset: ImmichAsset) {
  return {
    id: asset.id,
    type: asset.type,
    originalFileName: asset.originalFileName,
    fileCreatedAt: asset.fileCreatedAt,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
    width: asset.width ?? null,
    height: asset.height ?? null,
  };
}

/**
 * One NDJSON line per asset, all in the `full` phase. Gzipped when the client
 * accepts it: Cloudflare does not compress `application/x-ndjson` on its own.
 */
export function assetsNdjsonResponse(assets: ImmichAsset[], request: Request): Response {
  const body = assets
    .map((asset) => `${JSON.stringify({ phase: 'full', asset: slimAsset(asset) })}\n`)
    .join('');

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-ndjson',
    'Cache-Control': 'no-cache',
    Vary: 'Accept-Encoding',
  };

  if (!/\bgzip\b/.test(request.headers.get('accept-encoding') ?? '')) {
    return new Response(body, { headers });
  }

  headers['Content-Encoding'] = 'gzip';
  const gzipped = new Blob([body]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(gzipped, { headers });
}
