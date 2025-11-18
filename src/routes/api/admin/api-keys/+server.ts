import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createApiKey, listApiKeys, verifyRawKeyWithScope } from '$lib/db/api-keys';
import { getDatabase } from '$lib/db/database';
import { ensureAdmin } from '$lib/server/auth';

export const GET: RequestHandler = async ({ locals, cookies, request }) => {
  try {
    // allow admin via x-api-key header as well
    const apiKeyHeader = request.headers.get('x-api-key') || request.headers.get('X-API-KEY');
    if (apiKeyHeader) {
      if (!verifyRawKeyWithScope(apiKeyHeader, 'admin')) return json({ error: 'Unauthorized' }, { status: 401 });
    } else {
      const caller = await ensureAdmin({ locals, cookies });
      if (!caller) return json({ error: 'Unauthorized' }, { status: 401 });
    }

    const rows = listApiKeys();
    return json({ success: true, keys: rows });
  } catch (e) {
    console.error('GET /api/admin/api-keys error', e);
    return json({ success: false, error: (e as Error).message }, { status: 500 });
  }
};

export const POST: RequestHandler = async ({ locals, cookies, request }) => {
  try {
    // allow admin via x-api-key header as well
    const apiKeyHeader = request.headers.get('x-api-key') || request.headers.get('X-API-KEY');
    if (apiKeyHeader) {
      if (!verifyRawKeyWithScope(apiKeyHeader, 'admin')) return json({ error: 'Unauthorized' }, { status: 401 });
    } else {
      const caller = await ensureAdmin({ locals, cookies });
      if (!caller) return json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { label, scopes } = body;
    const { id, rawKey } = createApiKey(label, Array.isArray(scopes) ? scopes : undefined);
    return json({ success: true, id, rawKey });
  } catch (e) {
    console.error('POST /api/admin/api-keys error', e);
    return json({ success: false, error: (e as Error).message }, { status: 500 });
  }
};
