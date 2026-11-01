import { Marked, type Tokens } from 'marked';

/**
 * Markdown to HTML for the admin "Documentation interne" page.
 *
 * Rendered by `marked` (CommonMark + GFM) instead of a hand-rolled chain of regexes: a
 * hard-wrapped source line belongs to its paragraph, `**x**` is emphasis wherever it stands, lists
 * and fenced code behave as the spec says. The output is later set with `{@html}`, so the renderer
 * is configured to be safe by construction rather than trusted because the wiki is versioned:
 *
 * - raw HTML in the source is ESCAPED (it shows as text, it never becomes a tag);
 * - a link keeps its `href` only for http(s), mailto, an in-page `#anchor` or a relative path -
 *   `javascript:` and `data:` collapse to a plain span;
 * - an image is reduced to its alt text (the wiki references none, and a remote one would leak).
 *
 * Headings are shifted one level down: the card around a document already carries an `h2` with
 * its title, so a document's own `#` becomes `h2`'s child level, never a second page title.
 */

/** Escapes text placed between tags or inside a double-quoted attribute. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** True for the only href shapes the docs may carry. */
export function isSafeHref(href: string): boolean {
  const h = href.trim();
  if (h === '') {
    return false;
  }
  // A scheme is `letters:` before any `/`, `?` or `#`; relative and anchor links have none.
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(h);
  if (!scheme) {
    return !h.startsWith('//');
  }
  return ['http', 'https', 'mailto'].includes(scheme[1].toLowerCase());
}

const marked = new Marked({
  gfm: true,
  breaks: false,
  renderer: {
    html({ text }: Tokens.HTML | Tokens.Tag): string {
      return escapeHtml(text);
    },
    link(this: { parser: { parseInline: (t: Tokens.Generic[]) => string } }, token: Tokens.Link) {
      const inner = this.parser.parseInline(token.tokens);
      if (!isSafeHref(token.href)) {
        return `<span>${inner}</span>`;
      }
      const external = /^https?:/i.test(token.href);
      const attrs = external ? ' target="_blank" rel="noopener noreferrer"' : '';
      return `<a href="${escapeHtml(token.href)}"${attrs}>${inner}</a>`;
    },
    image({ text }: Tokens.Image): string {
      return escapeHtml(text);
    },
    heading(
      this: { parser: { parseInline: (t: Tokens.Generic[]) => string } },
      token: Tokens.Heading
    ) {
      const depth = Math.min(token.depth + 1, 6);
      return `<h${depth}>${this.parser.parseInline(token.tokens)}</h${depth}>\n`;
    },
  },
});

/** Renders a Markdown document to safe HTML. Empty input gives an empty string. */
export function mdToHtml(md: string): string {
  if (!md) {
    return '';
  }
  return marked.parse(md.replace(/\r\n/g, '\n'), { async: false });
}

/** A document split into its title (the first `# ` heading) and the rest. */
export interface SplitDoc {
  /** The first level-1 heading as plain text, or `null` when the document has none. */
  title: string | null;
  /** The source without that heading, so a page that shows the title does not repeat it. */
  body: string;
}

/** Markdown inline marks stripped to the text a person reads (`**a**`, `` `a` ``, `[a](u)`). */
export function plainInline(s: string): string {
  return s
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Takes the first `# ` heading out of a document (fenced code is not scanned). */
export function splitTitle(md: string): SplitDoc {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s{0,3}(```|~~~)/.test(lines[i])) {
      fence = !fence;
      continue;
    }
    const heading = !fence && /^#\s+(.+?)\s*#*\s*$/.exec(lines[i]);
    if (heading) {
      const rest = [...lines.slice(0, i), ...lines.slice(i + 1)].join('\n').replace(/^\n+/, '');
      return { title: plainInline(heading[1]), body: rest };
    }
  }
  return { title: null, body: lines.join('\n') };
}

/**
 * A short label for a sidebar entry: the title up to its first parenthesis, with the trailing
 * punctuation that leaves behind removed ("Face matching, option C (a sealed store...)" gives
 * "Face matching, option C"). Never empty: a title that starts with a parenthesis is kept whole.
 */
export function shortTitle(title: string): string {
  const cut = title.split(/\s+[(–—-]\s*/)[0].replace(/[\s,:;.-]+$/, '');
  return cut === '' ? title : cut;
}
