import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { decodeEntities, parseRich, type RichNode } from '#lib/rich-text.ts';
import { isSafeHref } from '#lib/safe-href.ts';

/** The words a reader sees, markup removed. */
function visibleText(nodes: RichNode[]): string {
  return nodes
    .map((n) => {
      if (n.kind === 'text') {
        return n.text;
      }
      if (n.kind === 'br') {
        return '\n';
      }
      return visibleText(n.children);
    })
    .join('');
}

/** A single backslash, spelled by code so no tool can eat an escape. */
const BS = String.fromCharCode(92);

describe('parseRich', () => {
  it('turns strong and em into elements, never into text', () => {
    const nodes = parseRich("Les <strong>clés d'API</strong> et <em>buffalo_l</em>.");
    expect(nodes.map((n) => n.kind)).toEqual(['text', 'strong', 'text', 'em', 'text']);
    expect(visibleText(nodes)).toBe("Les clés d'API et buffalo_l.");
  });

  it('nests marks and keeps the words', () => {
    const nodes = parseRich('<strong>a <em>b</em></strong>');
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ kind: 'strong' });
    expect(visibleText(nodes)).toBe('a b');
  });

  it('reads br with or without the slash', () => {
    expect(parseRich('a<br />b<br>c').map((n) => n.kind)).toEqual([
      'text',
      'br',
      'text',
      'br',
      'text',
    ]);
  });

  it('keeps a site link inline, with no target', () => {
    const [node] = parseRich('<a href="/parametres">paramètres</a>');
    expect(node).toMatchObject({ kind: 'a', href: '/parametres', external: false, mail: false });
  });

  it('opens an external link away, and marks the mail-link class', () => {
    const [ext] = parseRich(
      '<a href="https://www.cnil.fr" target="_blank" rel="noopener">cnil.fr</a>'
    );
    expect(ext).toMatchObject({ kind: 'a', external: true });
    const [mail] = parseRich(
      '<a href="mailto:bureau@mitv.fr" class="mail-link">bureau@mitv.fr</a>'
    );
    expect(mail).toMatchObject({ kind: 'a', mail: true, external: false });
  });

  it('refuses a script-bearing href and keeps the words', () => {
    const nodes = parseRich('<a href="javascript:alert(1)">click</a>');
    expect(nodes).toEqual([{ kind: 'span', children: [{ kind: 'text', text: 'click' }] }]);
    expect(isSafeHref('data:text/html,x')).toBe(false);
    expect(isSafeHref('//' + BS + 'evil.example/x')).toBe(false);
    expect(isSafeHref(' javascript:x')).toBe(false);
  });

  it('refuses control characters, tabs and newlines anywhere in an href', () => {
    for (const bad of [
      '\u0001javascript:alert(1)',
      'java\tscript:alert(1)',
      'java\nscript:alert(1)',
      'java\rscript:alert(1)',
      '\u0000javascript:alert(1)',
      '\u007fjavascript:alert(1)',
      '\u00a0javascript:alert(1)',
      '/ok\u0001',
    ]) {
      const [node] = parseRich(`<a href="${bad}">x</a>`);
      expect(node, JSON.stringify(bad)).toMatchObject({ kind: 'span' });
    }
  });

  it('refuses a slash-backslash host, which a browser reads as //host', () => {
    const [node] = parseRich(`<a href="/${BS}evil.example">x</a>`);
    expect(node).toMatchObject({ kind: 'span' });
    expect(isSafeHref('/' + BS + 'evil.example')).toBe(false);
    expect(isSafeHref('/albums')).toBe(true);
  });

  it('keeps an anchor nested in an anchor as text', () => {
    const nodes = parseRich('<a href="/a">one <a href="/b">two</a> three</a>');
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ kind: 'a', href: '/a' });
    const inner = (nodes[0] as { children: RichNode[] }).children;
    expect(inner.some((n) => n.kind === 'a')).toBe(false);
    expect(visibleText(nodes)).toBe('one <a href="/b">two</a> three');
  });

  it('shows an unknown tag as text instead of executing it', () => {
    const nodes = parseRich('x <script>alert(1)</script> <img src="a" onerror="b">');
    expect(nodes.every((n) => n.kind === 'text')).toBe(true);
    expect(visibleText(nodes)).toBe('x <script>alert(1)</script> <img src="a" onerror="b">');
  });

  it('closes tags left open and keeps a stray closer as text', () => {
    expect(visibleText(parseRich('<strong>open'))).toBe('open');
    expect(visibleText(parseRich('a</strong>b'))).toBe('a</strong>b');
  });

  it('decodes only the known entities', () => {
    expect(decodeEntities('a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39;&nbsp;f &foo;')).toBe(
      'a & b <c> "d" \'e\'\u00a0f &foo;'
    );
  });
});

/** Every .svelte file under src, as [path, source]. */
function svelteSources(dir: string, out: [string, string][] = []): [string, string][] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      svelteSources(full, out);
    } else if (entry.name.endsWith('.svelte')) {
      out.push([full, readFileSync(full, 'utf8')]);
    }
  }
  return out;
}

describe('translations that carry markup', () => {
  const locales = ['fr', 'en'].map(
    (l) =>
      [l, JSON.parse(readFileSync(`messages/${l}.json`, 'utf8')) as Record<string, string>] as const
  );
  const markupKeys = new Set<string>();
  for (const [, messages] of locales) {
    for (const [key, value] of Object.entries(messages)) {
      if (typeof value === 'string' && /<\/?[a-z]/i.test(value)) {
        markupKeys.add(key);
      }
    }
  }

  it('exist (the guard below is not vacuous)', () => {
    expect(markupKeys.size).toBeGreaterThan(30);
  });

  it('parse to the allowlisted nodes only, so no tag or entity can reach a reader as text', () => {
    for (const [locale, messages] of locales) {
      for (const key of markupKeys) {
        const value = messages[key];
        if (typeof value !== 'string') {
          continue;
        }
        const text = visibleText(parseRich(value));
        expect(text, `${locale}.${key}`).not.toMatch(/<\/?[a-z]+[^>]*>/i);
        expect(text, `${locale}.${key}`).not.toMatch(/&(?:[a-z]+|#\d+);/i);
      }
    }
  });

  it('are never printed through a plain {m.key()} (which would show the tags)', () => {
    // Per OCCURRENCE: the only accepted use is `text={m.key(...)}` on RichText.
    const offenders: string[] = [];
    for (const [file, source] of svelteSources('src')) {
      for (const use of source.matchAll(/(text=)?\{(@html )?m\.([a-z0-9_]+)\(/g)) {
        const [, rich, html, key] = use;
        if (markupKeys.has(key) && (!rich || html)) {
          offenders.push(`${file}: ${key}${html ? ' (@html)' : ''}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the guard itself catches a second, bare use in a file that also uses RichText', () => {
    const source = '<RichText text={m.k()} /> <p>{m.k()}</p>';
    const bare = [...source.matchAll(/(text=)?\{(@html )?m\.([a-z0-9_]+)\(/g)].filter(
      (u) => !u[1] || u[2]
    );
    expect(bare).toHaveLength(1);
  });
});
