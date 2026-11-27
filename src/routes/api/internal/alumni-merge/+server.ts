import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { handleAlumniMergeCall } from '#lib/server/alumni-merge/endpoint.ts';

/**
 * POST /api/internal/alumni-merge - Canari's server-to-server call for one Alumni merge: move what
 * the duplicate account owns onto the real one, then erase the duplicate
 * (`#lib/server/alumni-merge/endpoint.ts`, docs/wiki/alumni-merge.md). The body is ignored: every
 * input is a claim of the signed token in `Authorization`.
 */
export const POST: RequestHandler = async ({ request }) => {
  const result = await handleAlumniMergeCall({
    authorization: request.headers.get('authorization'),
  });
  return json(result.body, { status: result.status, headers: { 'cache-control': 'no-store' } });
};
