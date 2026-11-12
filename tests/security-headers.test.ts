import { beforeEach, describe, expect, it } from 'vitest';
import {
  applySecurityHeaders,
  CSP_REPORT_LINES_PER_HOUR,
  CSP_REPORT_MAX_BYTES,
  forgetCspReports,
  logCspLine,
  noteCspReport,
  SECURITY_HEADERS,
} from '#lib/server/security-headers.ts';
import { appHtmlScriptHashes, CSP, CSP_REPORT_PATH } from '../csp.config';
import { TEST_CONFIG } from './test-helpers.ts';

/**
 * The headers every answer carries, and the content security policy in its observing release:
 * nothing is blocked yet, and what WOULD be is logged where it can be read.
 */

const { API_BASE_URL } = TEST_CONFIG;

describe('the headers of every answer', () => {
  it('are nosniff, an origin-only referrer across sites, and no framing by another site', () => {
    expect(SECURITY_HEADERS).toEqual({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Frame-Options': 'SAMEORIGIN',
    });
  });

  it('are written on a response that has none', () => {
    const headers = new Headers();
    applySecurityHeaders(headers);

    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(headers.get(name)).toBe(value);
    }
  });

  it('leave a stricter value a route already set', () => {
    const headers = new Headers({ 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' });
    applySecurityHeaders(headers);

    expect(headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(headers.get('X-Frame-Options')).toBe('DENY');
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
  });
});

describe('a violation report', () => {
  beforeEach(() => forgetCspReports());

  const report = (blocked = 'https://cdn.example/a.js?v=3') =>
    JSON.stringify({
      'csp-report': {
        'effective-directive': 'script-src-elem',
        'blocked-uri': blocked,
        'document-uri': 'https://gallery.example/albums/x?id=someone#top',
        'source-file': 'https://gallery.example/_app/immutable/a.js',
      },
    });

  it('is logged once, with no query and no fragment in it', () => {
    expect(noteCspReport(report())).toBe(
      'would block: directive=script-src-elem blocked=https://cdn.example/a.js page=https://gallery.example/albums/x source=https://gallery.example/_app/immutable/a.js (occurrence #1)'
    );
    expect(noteCspReport(report())).toBeNull();
  });

  it('is then said at its 10th and 100th occurrence, with the count', () => {
    const said = Array.from({ length: 100 }, () => noteCspReport(report())).filter(Boolean);

    expect(said).toHaveLength(3);
    expect(said[1]).toContain('(occurrence #10)');
    expect(said[2]).toContain('(occurrence #100)');
  });

  it('counts another blocked resource apart', () => {
    noteCspReport(report());

    expect(noteCspReport(report('https://other.example/b.js'))).toContain('(occurrence #1)');
  });

  it('reads the Reporting API shape too', () => {
    const line = noteCspReport(
      JSON.stringify([
        {
          type: 'csp-violation',
          body: {
            effectiveDirective: 'img-src',
            blockedURL: 'https://img.example/x.png',
            documentURL: 'https://gallery.example/',
          },
        },
      ])
    );

    expect(line).toContain('directive=img-src blocked=https://img.example/x.png');
  });

  it.each(['not json', '{}', '[]', 'null', '{"csp-report":"text"}'])('drops %p', (raw) => {
    expect(noteCspReport(raw)).toBeNull();
  });

  /** U+2028, which ends a line as a newline does; named by its code so no tool rewrites it. */
  const LINE_SEPARATOR = String.fromCharCode(0x2028);

  it('writes no control character and no white space of a reported value', () => {
    const line = noteCspReport(
      report(
        `https://cdn.example/a.js\r\n2026-11-12 [SECURITY] forged\u0000\u001b[31m${LINE_SEPARATOR} line`
      )
    );

    expect(line).toContain(
      'blocked=https://cdn.example/a.js2026-11-12[SECURITY]forged[31mline page='
    );
    expect(line).not.toMatch(/\p{Cc}/u);
    expect(line).not.toContain(LINE_SEPARATOR);
    expect(line?.split(' ')).toHaveLength(8);
  });

  it('names a value made only of control characters as absent', () => {
    expect(noteCspReport(report('\n\r\t'))).toContain('blocked=- page=');
  });
});

describe('the lines a report may write', () => {
  beforeEach(() => forgetCspReports());

  const HOUR = 3_600_000;
  const distinct = (n: number) =>
    JSON.stringify({
      'csp-report': { 'effective-directive': 'img-src', 'blocked-uri': `https://x.example/${n}` },
    });

  it('stop at the hourly bound, whatever is sent, and the bound is said once', () => {
    const at = 7 * HOUR + 5;

    const written = Array.from({ length: CSP_REPORT_LINES_PER_HOUR + 400 }, (_, n) =>
      logCspLine(`line ${n}`, at)
    ).filter(Boolean);

    expect(written).toHaveLength(CSP_REPORT_LINES_PER_HOUR + 1);
    expect(written.at(-2)).toBe(`line ${CSP_REPORT_LINES_PER_HOUR - 1}`);
    expect(written.at(-1)).toContain('report lines this hour');
  });

  it('count every kind of line: a violation, an unreadable report, a dropped one', () => {
    const at = 7 * HOUR;
    for (let n = 1; n < CSP_REPORT_LINES_PER_HOUR; n++) noteCspReport(distinct(n), at);

    expect(noteCspReport('not json', at)).toBeNull();
    expect(noteCspReport(distinct(0), at)).toBeNull();
    expect(logCspLine('a report of 9000 bytes was dropped unread', at)).toBeNull();
  });

  it('start again in the next clock hour', () => {
    const at = 7 * HOUR;
    for (let n = 0; n <= CSP_REPORT_LINES_PER_HOUR; n++) noteCspReport(distinct(n), at);

    expect(noteCspReport(distinct(-1), at + HOUR - 1)).toBeNull();
    expect(noteCspReport(distinct(-2), at + HOUR)).toContain('(occurrence #1)');
  });
});

describe('the content security policy', () => {
  it('enforces that no other site frames this one', () => {
    expect(CSP.directives).toEqual({ 'frame-ancestors': ['self'] });
  });

  it('observes the rest for this release, and reports to the route above', () => {
    expect(CSP.reportOnly['default-src']).toEqual(['self']);
    expect(CSP.reportOnly['object-src']).toEqual(['none']);
    expect(CSP.reportOnly['report-uri']).toEqual([CSP_REPORT_PATH]);
  });

  it("names the hash of the template's inline theme script", () => {
    const hashes = appHtmlScriptHashes('<head><script>var a = 1;</script></head>');

    expect(hashes).toEqual(['sha256-+dZ6udsWxNVoGfScAq7t5IIF5UJb4F6RhjbN6oe1p4w=']);
    expect(CSP.reportOnly['script-src'].length).toBeGreaterThan(1);
  });

  it('finds an inline script whatever its casing, attributes and closing tag, and skips one with a src', () => {
    const one = 'sha256-+dZ6udsWxNVoGfScAq7t5IIF5UJb4F6RhjbN6oe1p4w=';

    expect(appHtmlScriptHashes('<SCRIPT type="module">var a = 1;</Script >')).toEqual([one]);
    expect(appHtmlScriptHashes('<script src="/a.js"></script><script>var a = 1;</script>')).toEqual(
      [one]
    );
  });
});

describe('on the running server', () => {
  const expectSecurityHeaders = (res: Response) => {
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toMatch(
      /^(strict-origin-when-cross-origin|no-referrer)$/
    );
    expect(res.headers.get('x-frame-options')).toBe('SAMEORIGIN');
  };

  it('a page carries the three headers and both policies', async () => {
    const res = await fetch(`${API_BASE_URL}/`);

    expectSecurityHeaders(res);
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'self'");
    const observed = res.headers.get('content-security-policy-report-only') ?? '';
    expect(observed).toContain("default-src 'self'");
    expect(observed).toContain(`report-uri ${CSP_REPORT_PATH}`);
    // The template's theme script and the scripts SvelteKit writes are all named by a hash or a
    // nonce, quoted.
    expect(observed).toMatch(/script-src [^;]*'sha256-[A-Za-z0-9+/=]+'/);
  });

  it('a redirect carries the three headers', async () => {
    const res = await fetch(`${API_BASE_URL}/mes-photos`, { redirect: 'manual' });

    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expectSecurityHeaders(res);
  });

  it('an API answer carries the three headers', async () => {
    const res = await fetch(`${API_BASE_URL}/api/health`);

    expect(res.status).toBe(200);
    expectSecurityHeaders(res);
  });

  it('the handoff landing page keeps its stricter values', async () => {
    const res = await fetch(`${API_BASE_URL}/auth/handoff`);

    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('content-security-policy')).toBe("frame-ancestors 'none'");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('a report is answered 204 with no session, in either shape', async () => {
    const legacy = await fetch(`${API_BASE_URL}${CSP_REPORT_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/csp-report', origin: API_BASE_URL },
      body: JSON.stringify({ 'csp-report': { 'effective-directive': 'img-src' } }),
    });
    const modern = await fetch(`${API_BASE_URL}${CSP_REPORT_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/reports+json' },
      body: JSON.stringify([{ type: 'csp-violation', body: { effectiveDirective: 'img-src' } }]),
    });

    expect(legacy.status).toBe(204);
    expect(modern.status).toBe(204);
    expectSecurityHeaders(legacy);
  });

  it('a report past the limit is dropped and still answered 204', async () => {
    const res = await fetch(`${API_BASE_URL}${CSP_REPORT_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/csp-report' },
      body: 'x'.repeat(CSP_REPORT_MAX_BYTES + 1),
    });

    expect(res.status).toBe(204);
  });
});
