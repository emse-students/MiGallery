import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { decodeEntities, parseRich, isSafeRichHref, type RichNode } from '#lib/rich-text.ts';

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
    expect(isSafeRichHref('data:text/html,x')).toBe(false);
    expect(isSafeRichHref('//evil.example/x')).toBe(false);
    expect(isSafeRichHref(' javascript:x')).toBe(false);
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
      'a & b <c> "d" \'e\' f &foo;'
    );
  });
});

/** Every .svelte file under src, as [path, source]. */
function svelteSources(dir: string, out: [string, string][] = []): [string, string][] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      svelteSources(full, out);
    } else if (name.endsWith('.svelte')) {
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
    const offenders: string[] = [];
    for (const [file, source] of svelteSources('src')) {
      for (const key of markupKeys) {
        if (source.includes(`{m.${key}(`) && !source.includes(`text={m.${key}(`)) {
          offenders.push(`${file}: ${key}`);
        }
        if (source.includes(`{@html m.${key}(`)) {
          offenders.push(`${file}: ${key} (@html)`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
