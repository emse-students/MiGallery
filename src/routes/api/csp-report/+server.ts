import type { RequestHandler } from './$types';
import { createLogger } from '#lib/server/logger.ts';
import { CSP_REPORT_MAX_BYTES, noteCspReport } from '#lib/server/security-headers.ts';

const log = createLogger('csp');

/**
 * Where browsers post what the report-only content security policy would have blocked
 * (`csp.config.ts`, `reportOnly`). Public: a visitor with no session sends reports too, and no
 * permission helper is called. Nothing is stored; a distinct violation is one log line
 * (`noteCspReport`). Always 204 - a browser does nothing with the answer.
 */
export const POST: RequestHandler = async ({ request }) => {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > CSP_REPORT_MAX_BYTES) {
    log.warn(`a report of ${declared} bytes was dropped unread`);
    return new Response(null, { status: 204 });
  }
  const raw = await request.text();
  if (raw.length > CSP_REPORT_MAX_BYTES) {
    log.warn(`a report of ${raw.length} characters was dropped`);
    return new Response(null, { status: 204 });
  }
  noteCspReport(raw);
  return new Response(null, { status: 204 });
};
