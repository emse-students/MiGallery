import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { isSafeHref, mdToHtml, plainInline, shortTitle, splitTitle } from '#lib/docs/render-md.ts';

describe('mdToHtml: CommonMark behaviour', () => {
  it('joins hard-wrapped lines into one paragraph', () => {
    const html = mdToHtml(
      'MiGallery is a gallery\nfor EMSE, wrapped\nover three lines.\n\nSecond paragraph.'
    );
    expect(html.match(/<p>/g)).toHaveLength(2);
    expect(html).toContain('<p>MiGallery is a gallery\nfor EMSE, wrapped\nover three lines.</p>');
  });

  it('renders ** as strong, also across a wrapped line, never as an escaped tag', () => {
    const html = mdToHtml(
      'wraps **Immich** (a self-hosted\nbackend) and an **authenticated proxy**.'
    );
    expect(html).toContain('<strong>Immich</strong>');
    expect(html).toContain('<strong>authenticated proxy</strong>');
    expect(html).not.toContain('&lt;strong');
  });

  it('renders lists, fenced code and tables', () => {
    const html = mdToHtml(
      '- one\n- two\n\n```ts\nconst a = 1 < 2;\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n'
    );
    expect(html).toContain('<ul>');
    expect(html.match(/<li>/g)).toHaveLength(2);
    expect(html).toContain('const a = 1 &lt; 2;');
    expect(html).toContain('<table>');
  });

  it('shifts headings one level down under the card title', () => {
    const html = mdToHtml('# A\n\n## B\n\n###### F');
    expect(html).toContain('<h2>A</h2>');
    expect(html).toContain('<h3>B</h3>');
    expect(html).toContain('<h6>F</h6>');
  });

  it('is empty for empty input and accepts CRLF', () => {
    expect(mdToHtml('')).toBe('');
    expect(mdToHtml('a\r\nb')).toBe('<p>a\nb</p>\n');
  });
});

describe('mdToHtml: sanitising', () => {
  it('escapes raw HTML instead of emitting it', () => {
    const html = mdToHtml(
      'hello <script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n<div>x</div>'
    );
    expect(html).not.toMatch(/<script|<img|<div/i);
    expect(html).toContain('&lt;script&gt;');
  });

  it('drops the href of a javascript: or data: link and keeps its words', () => {
    const html = mdToHtml(
      '[x](javascript:alert(1)) and [y](data:text/html,z) and [w](JaVaScRiPt:1)'
    );
    expect(html).not.toMatch(/href/i);
    expect(html).toContain('<span>x</span>');
  });

  it('keeps safe links, external ones opening away', () => {
    const html = mdToHtml(
      '[a](https://example.com/p?q=1&r=2) [b](#anchor) [c](./x.md) [d](mailto:a@b.fr)'
    );
    expect(html).toContain(
      'href="https://example.com/p?q=1&amp;r=2" target="_blank" rel="noopener noreferrer"'
    );
    expect(html).toContain('<a href="#anchor">b</a>');
    expect(html).toContain('<a href="./x.md">c</a>');
    expect(html).toContain('<a href="mailto:a@b.fr">d</a>');
  });

  it('reduces an image to its alt text', () => {
    const html = mdToHtml('![alt text](https://tracker.example/p.png)');
    expect(html).not.toContain('<img');
    expect(html).toContain('alt text');
  });

  it('refuses a protocol-relative href', () => {
    expect(isSafeHref('//evil.example')).toBe(false);
    expect(isSafeHref('')).toBe(false);
    expect(isSafeHref('/albums')).toBe(true);
  });
});

describe('splitTitle, shortTitle, plainInline', () => {
  it('takes the first level-1 heading out of the body', () => {
    const { title, body } = splitTitle('# MiGallery technical wiki\n\nIntro.\n\n## Part\n');
    expect(title).toBe('MiGallery technical wiki');
    expect(body).not.toContain('technical wiki');
    expect(body).toContain('Intro.');
    expect(body).toContain('## Part');
  });

  it('does not read a # comment inside a fenced block as the title', () => {
    const { title, body } = splitTitle('```sh\n# not a title\n```\n\n# Real\n');
    expect(title).toBe('Real');
    expect(body).toContain('# not a title');
  });

  it('has no title when there is no level-1 heading', () => {
    expect(splitTitle('## only\n')).toEqual({ title: null, body: '## only\n' });
  });

  it('strips inline marks from a title', () => {
    expect(plainInline('The `proxy` **layer** [docs](x.md)')).toBe('The proxy layer docs');
  });

  it('shortens a long title at its first parenthesis', () => {
    expect(
      shortTitle('Face matching, option C (a sealed store of face embeddings, no clustering)')
    ).toBe('Face matching, option C');
    expect(shortTitle('Search')).toBe('Search');
    expect(shortTitle('(only a parenthesis)')).toBe('(only a parenthesis)');
  });
});

describe('the real wiki', () => {
  const dir = 'docs/wiki';
  const files = readdirSync(dir).filter((f) => f.endsWith('.md'));

  it('renders every page without a stray tag or a leftover ** marker', () => {
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      const { body } = splitTitle(readFileSync(`${dir}/${f}`, 'utf8'));
      const html = mdToHtml(body);
      // Tags written in prose or code are escaped, never emitted: no live <script>/<img>.
      expect(html, f).not.toMatch(/<(script|img|iframe)/i);
      // Emphasis marks are consumed outside code (<code>/<pre> may legitimately hold **).
      const prose = html
        .replace(/<pre>[\s\S]*?<\/pre>/g, '')
        .replace(/<code>[\s\S]*?<\/code>/g, '');
      expect(prose, f).not.toContain('&lt;strong');
      expect(prose, f).not.toMatch(/\*\*[^\s*]/);
    }
  });
});
