import { createLogger } from '#lib/server/logger.ts';

/**
 * The response headers every answer of this site carries, whatever front it sits behind.
 *
 * - `X-Content-Type-Options: nosniff` - a browser uses the type the server declared, never one it
 *   guessed from the bytes.
 * - `Referrer-Policy: strict-origin-when-cross-origin` - a link leaving the site carries its
 *   origin, never the path of the page it was on.
 * - `X-Frame-Options: SAMEORIGIN` - no other site may display this one inside a frame.
 *
 * `Strict-Transport-Security` is not here: it belongs to whatever terminates TLS, which is the
 * front, and a header set by a server that speaks plain HTTP behind it says nothing true.
 *
 * The content security policy is declared in `csp.config.ts`, read by `vite.config.ts`, because
 * SvelteKit has to add a hash for each inline script it writes; see `docs/wiki/architecture.md`.
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN',
};

/**
 * Writes {@link SECURITY_HEADERS} on a response. A stricter value a route already set is kept
 * (the sign-in handoff's landing page answers `Referrer-Policy: no-referrer`): the site-wide value
 * is the floor, not a replacement.
 */
export function applySecurityHeaders(headers: Headers): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(name)) headers.set(name, value);
  }
}

const log = createLogger('csp');

/** Largest report body read; a browser's report is a few hundred bytes. */
export const CSP_REPORT_MAX_BYTES = 8_192;

/** Distinct violations remembered; past it the memory is emptied and each is said again. */
const MAX_REMEMBERED = 500;

const seen = new Map<string, number>();

/** Report lines written in one clock hour; a page that breaks the policy says a handful. */
export const CSP_REPORT_LINES_PER_HOUR = 200;

const HOUR_MS = 3_600_000;

let lineHour = -1;
let linesThisHour = 0;

/** Forget every violation and every line counted so far (tests). */
export function forgetCspReports(): void {
  seen.clear();
  lineHour = -1;
  linesThisHour = 0;
}

/**
 * Writes one line about a report, unless this clock hour already wrote
 * {@link CSP_REPORT_LINES_PER_HOUR}: the route is public, so what it may write is bounded whatever
 * is sent to it. The line that passes the bound is replaced by ONE line saying so, and the rest of
 * the hour writes nothing. The hour is the only thing read from the clock.
 *
 * @returns what was written: `line`, the one line that says the bound was passed, or `null`
 */
export function logCspLine(line: string, now: number = Date.now()): string | null {
  const hour = Math.floor(now / HOUR_MS);
  if (hour !== lineHour) {
    lineHour = hour;
    linesThisHour = 0;
  }
  linesThisHour += 1;
  if (linesThisHour <= CSP_REPORT_LINES_PER_HOUR) {
    log.warn(line);
    return line;
  }
  if (linesThisHour > CSP_REPORT_LINES_PER_HOUR + 1) {
    return null;
  }
  const bound = `more than ${CSP_REPORT_LINES_PER_HOUR} report lines this hour: nothing more is written until the next`;
  log.warn(bound);
  return bound;
}

/**
 * A URL reduced to what names the resource: no query, no fragment, bounded - and no control
 * character or white space, so a value never ends the log line it is written in nor reads as a
 * second field of it.
 */
function bare(value: unknown): string {
  if (typeof value !== 'string') {
    return '-';
  }
  const named = value
    .split(/[?#]/)[0]
    .replace(/[\p{Cc}\s]/gu, '')
    .slice(0, 200);
  return named === '' ? '-' : named;
}

/**
 * Reads one browser report and logs it: once for each distinct violation (directive, blocked
 * resource, page), then at its 10th, 100th... occurrence with the count. A violation is a RATE -
 * every visitor of a page sends the same one - so the count is what is worth a line.
 *
 * Both report shapes are read: the `report-uri` one (`{"csp-report": {...}}`) and the Reporting
 * API one (`[{"type":"csp-violation","body":{...}}]`).
 *
 * @returns the line that was logged, or `null` when nothing was (unreadable, already said, or
 *   past the hour's bound)
 */
export function noteCspReport(raw: string, now: number = Date.now()): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logCspLine('a report that is not JSON was dropped', now);
    return null;
  }
  const first = Array.isArray(parsed) ? parsed[0] : parsed;
  const body =
    (first as Record<string, unknown> | null)?.['csp-report'] ??
    (first as Record<string, unknown> | null)?.body;
  if (!body || typeof body !== 'object') {
    logCspLine('a report with no violation in it was dropped', now);
    return null;
  }
  const report = body as Record<string, unknown>;
  const directive = bare(
    report['effective-directive'] ?? report.effectiveDirective ?? report['violated-directive']
  );
  const blocked = bare(report['blocked-uri'] ?? report.blockedURL);
  const page = bare(report['document-uri'] ?? report.documentURL);
  const source = bare(report['source-file'] ?? report.sourceFile);

  const key = `${directive}|${blocked}|${page}`;
  if (!seen.has(key) && seen.size >= MAX_REMEMBERED) seen.clear();
  const count = (seen.get(key) ?? 0) + 1;
  seen.set(key, count);
  if (count !== 1 && !/^10*$/.test(String(count))) return null;

  const line = `would block: directive=${directive} blocked=${blocked} page=${page} source=${source} (occurrence #${count})`;
  return logCspLine(line, now) === line ? line : null;
}
