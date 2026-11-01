/**
 * Inline markup carried by a few translation strings (`<strong>`, `<em>`, `<br />`, `<a href>`),
 * parsed into a tree that `RichText.svelte` renders as real elements.
 *
 * Why not `{@html}`: a translation is not user input, but `{@html}` is all-or-nothing - one string
 * that forgets it and the tags show as text, and one day a string with a `<script>` would run.
 * Here the allowlist is the parser: only the four tags below exist, only `href` (http(s), mailto,
 * an anchor or a site path), `target`, `rel` and `class="mail-link"` survive on a link, and every
 * other `<` stays plain text that Svelte escapes. No string is ever concatenated into markup.
 */

/** A text run or an allowed element with its children. */
export type RichNode =
  | { kind: 'text'; text: string }
  | { kind: 'br' }
  | { kind: 'strong' | 'em' | 'span'; children: RichNode[] }
  | {
      kind: 'a';
      href: string;
      external: boolean;
      mail: boolean;
      children: RichNode[];
    };

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

/** Decodes the few entities a translation may carry; nothing else is decoded. */
export function decodeEntities(text: string): string {
  return text.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39);/g, (e) => ENTITIES[e] ?? e);
}

/** True for an `href` a translation may carry. */
export function isSafeRichHref(href: string): boolean {
  if (href.startsWith('//')) {
    return false;
  }
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href);
  if (!scheme) {
    return href.startsWith('/') || href.startsWith('#');
  }
  return ['http', 'https', 'mailto'].includes(scheme[1].toLowerCase());
}

const TAG = /<(\/?)([a-z]+)((?:\s+[a-z-]+="[^"]*")*)\s*(\/?)>/gi;

function attributesOf(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of raw.matchAll(/([a-z-]+)="([^"]*)"/gi)) {
    out[m[1].toLowerCase()] = decodeEntities(m[2]);
  }
  return out;
}

interface Frame {
  tag: 'root' | 'strong' | 'em' | 'a';
  children: RichNode[];
  attrs: Record<string, string>;
}

function close(frame: Frame): RichNode {
  if (frame.tag === 'a') {
    const href = frame.attrs.href ?? '';
    if (isSafeRichHref(href)) {
      return {
        kind: 'a',
        href,
        external: /^https?:/i.test(href),
        mail: (frame.attrs.class ?? '').split(/\s+/).includes('mail-link'),
        children: frame.children,
      };
    }
    // An unsafe or missing href: keep the words, drop the link.
    return { kind: 'span', children: frame.children };
  }
  return { kind: frame.tag as 'strong' | 'em', children: frame.children };
}

/**
 * Parses a translation into nodes. Unknown tags and stray closers are kept as literal text;
 * tags left open at the end are closed, so a malformed string still renders its words.
 */
export function parseRich(source: string): RichNode[] {
  const stack: Frame[] = [{ tag: 'root', children: [], attrs: {} }];
  const top = () => stack[stack.length - 1];
  const pushText = (text: string) => {
    if (text !== '') {
      top().children.push({ kind: 'text', text });
    }
  };

  let last = 0;
  for (const m of source.matchAll(TAG)) {
    const [whole, closing, rawName, rawAttrs, selfClosing] = m;
    const name = rawName.toLowerCase();
    pushText(decodeEntities(source.slice(last, m.index)));
    last = m.index + whole.length;

    if (name === 'br' && !closing) {
      top().children.push({ kind: 'br' });
    } else if (name === 'strong' || name === 'em' || name === 'a') {
      if (closing) {
        if (top().tag === name && stack.length > 1) {
          const done = stack.pop() as Frame;
          top().children.push(close(done));
        } else {
          pushText(whole);
        }
      } else if (selfClosing) {
        pushText(whole);
      } else {
        stack.push({ tag: name, children: [], attrs: attributesOf(rawAttrs) });
      }
    } else {
      pushText(whole);
    }
  }
  pushText(decodeEntities(source.slice(last)));

  while (stack.length > 1) {
    const done = stack.pop() as Frame;
    top().children.push(close(done));
  }
  return stack[0].children;
}
