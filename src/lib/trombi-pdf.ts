/**
 * Trombinoscope PDF: the layout (pure, tested), the sheet's markup (pure, tested) and the export.
 *
 * Modelled on Canari's trombinoscope (`frontend/src/lib/utils/trombinoscope.ts`): the sheet is HTML
 * in MiGallery's own fonts, rasterised by the browser, with the text re-drawn as real vector text
 * (`pdf/searchable-raster.ts`). What differs from Canari: MiGallery paginates BEFORE rendering, one
 * fixed A4-sized `.page` per page, so a cell is never cut by a page boundary; every name wraps in the
 * browser (fixed cell width, `text-wrap: balance`) and an overlong one is cut to two lines with an
 * ellipsis by MEASURING the browser's own layout, never by re-wrapping in a second engine.
 */
import { escapeHtmlAttribute } from '#lib/escape-html.ts';

/** Brand tokens of `src/app.css`, as the sheet uses them (print is always on white). */
export const TROMBI_COLORS = {
  text: '#111827',
  muted: '#6b7280',
  border: '#e5e7eb',
  accent: '#3b82f6',
  accentLight: '#eff6ff',
  /** The flat fill of the app's avatar fallback (`--purple`). */
  placeholder: '#a855f7',
} as const;

/** A4 portrait in CSS pixels at 96 dpi: 794 wide, the height keeps the 210x297 ratio. */
export const TROMBI_GEOMETRY = {
  pageWidth: 794,
  pageHeight: (297 * 794) / 210,
  margin: 56,
  /** Space under the top margin taken by the running header (title and rule). */
  headerHeight: 56,
  /** Space above the bottom margin taken by the page number. */
  footerHeight: 24,
  columns: 5,
  /** THE one tile shape: photo, failed photo and initials all use this size and radius. */
  tileSize: 96,
  tileRadius: 20,
  nameGap: 8,
  nameFontPx: 11.5,
  nameLineHeight: 1.25,
  nameMaxLines: 2,
  rowGap: 16,
  bandHeight: 34,
  bandGap: 14,
} as const;

type Geometry = typeof TROMBI_GEOMETRY;

/** Height of a row of cells: a tile, then two name lines at most, then the gap. */
export function rowHeight(g: Geometry = TROMBI_GEOMETRY): number {
  return g.tileSize + g.nameGap + g.nameFontPx * g.nameLineHeight * g.nameMaxLines + g.rowGap;
}

/** Width of one cell: the content width cut into equal columns. */
export function cellWidth(g: Geometry = TROMBI_GEOMETRY): number {
  return (g.pageWidth - g.margin * 2) / g.columns;
}

export interface TrombiSection {
  label: string;
  /** Members of the section, in display order. */
  count: number;
}

/** Something to place: a section band, or the cell of the n-th member of a section. */
export type Placement =
  | { kind: 'band'; page: number; y: number; section: number }
  | { kind: 'cell'; page: number; x: number; y: number; section: number; member: number };

/**
 * Places every band and cell. A row is never split across pages; a band always has at least one
 * full row under it on its page (it moves to the next page with that row otherwise); every page
 * starts under the running header.
 */
export function layoutTrombi(
  sections: TrombiSection[],
  g: Geometry = TROMBI_GEOMETRY
): Placement[] {
  const top = g.margin + g.headerHeight;
  const bottom = g.pageHeight - g.margin - g.footerHeight;
  const rh = rowHeight(g);
  const cw = cellWidth(g);
  const out: Placement[] = [];
  let page = 1;
  let y = top;

  sections.forEach((section, s) => {
    if (section.count === 0) return;
    if (y + g.bandHeight + g.bandGap + rh > bottom && y > top) {
      page++;
      y = top;
    }
    out.push({ kind: 'band', page, y, section: s });
    y += g.bandHeight + g.bandGap;
    for (let i = 0; i < section.count; i += g.columns) {
      if (y + rh > bottom) {
        page++;
        y = top;
      }
      for (let c = 0; c < g.columns && i + c < section.count; c++) {
        out.push({ kind: 'cell', page, x: g.margin + c * cw, y, section: s, member: i + c });
      }
      y += rh;
    }
    y += g.bandGap;
  });
  return out;
}

/** A member as the sheet needs it. */
export interface TrombiMember {
  id: string;
  /** Display name, used only where first and last name are both missing. */
  name: string;
  firstName: string | null;
  lastName: string | null;
  /** Data URL of the photo, or null: the member gets the initials tile. */
  image: string | null;
}

export interface TrombiSectionData {
  label: string;
  members: TrombiMember[];
}

export interface TrombiTexts {
  title: string;
  /** "58 members". */
  subtitle: string;
  /** Export date, already formatted. */
  date: string;
  page: (page: number, total: number) => string;
  count: (n: number) => string;
}

const collator = new Intl.Collator('fr', { sensitivity: 'base' });

/**
 * Alphabetical by LAST NAME, then first name, in a French collation that ignores case and accents
 * (an accented initial sorts with its base letter). The last name is the `last_name` field as stored,
 * compound names whole (`LE GRAËT`, `MARTIN--CHAN-YAT-TSEUNG`); the display name stands in only for a
 * member who has no last name at all. Returns a new array.
 */
export function sortMembers<
  T extends { name: string; firstName: string | null; lastName: string | null },
>(members: T[]): T[] {
  const last = (m: T) => (m.lastName ?? '').trim() || m.name.trim();
  const first = (m: T) => (m.firstName ?? '').trim();
  return [...members].sort(
    (a, b) => collator.compare(last(a), last(b)) || collator.compare(first(a), first(b))
  );
}

/** Up to two initials, the same reading as the app's avatar fallback (first + last name). */
export function initialsOf(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
  fullName: string
): string {
  const f = (firstName ?? '').trim();
  const l = (lastName ?? '').trim();
  if (f || l) return `${f[0] ?? ''}${l[0] ?? ''}`.toUpperCase() || '?';
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

const FONT_BODY = "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif";
const FONT_DISPLAY = "'Space Grotesk', 'Inter', system-ui, sans-serif";

/**
 * The one tile frame, as a style string: the SAME for a loaded photo, a failed photo and no photo.
 * The background is the initials colour, so a photo that does not cover its frame shows the same
 * shape, and the photo is clipped by the frame's radius.
 */
export function tileStyle(g: Geometry = TROMBI_GEOMETRY): string {
  return `position:relative;flex-shrink:0;overflow:hidden;width:${g.tileSize}px;height:${g.tileSize}px;border-radius:${g.tileRadius}px;background:${TROMBI_COLORS.placeholder};`;
}

/** The markup of one member's tile: the photo (if any) over the initials, both inside the frame. */
export function tileHtml(member: TrombiMember, g: Geometry = TROMBI_GEOMETRY): string {
  const safe = escapeHtmlAttribute;
  const initials = safe(initialsOf(member.firstName, member.lastName, member.name));
  const hasPhoto = member.image !== null;
  // A member with no photo has NO <img> at all: the rasteriser draws any <img> it cannot inline,
  // hidden or not, as a box reading "img".
  const img = hasPhoto
    ? `<img data-trombi-photo src="${safe(member.image as string)}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;" />`
    : '';
  return `<div data-trombi-tile style="${tileStyle(g)}">${img}<div data-trombi-initials style="position:absolute;inset:0;display:${hasPhoto ? 'none' : 'flex'};align-items:center;justify-content:center;font:600 ${Math.round(g.tileSize * 0.32)}px/1 ${FONT_BODY};color:#ffffff;">${initials}</div></div>`;
}

/**
 * The whole sheet's markup, set as `innerHTML` by {@link exportTrombinoscope}: one fixed-size
 * `.page` per page, every cell absolutely placed from {@link layoutTrombi}. Every value that comes
 * from the API is escaped where it is interpolated.
 */
export function buildTrombiHtml(
  sections: TrombiSectionData[],
  texts: TrombiTexts,
  g: Geometry = TROMBI_GEOMETRY
): { html: string; pages: number } {
  const safe = escapeHtmlAttribute;
  const placements = layoutTrombi(
    sections.map((s) => ({ label: s.label, count: s.members.length })),
    g
  );
  const pages = placements.reduce((n, p) => Math.max(n, p.page), 1);
  const cw = cellWidth(g);
  const nameLinePx = g.nameFontPx * g.nameLineHeight;

  const header = `
    <div style="position:absolute;left:${g.margin}px;top:${g.margin}px;display:flex;gap:10px;align-items:baseline;">
      <span data-pdf-text style="font:700 26px/32px ${FONT_DISPLAY};color:${TROMBI_COLORS.text};">${safe(texts.title)}</span>
      <span data-pdf-text style="font:700 26px/32px ${FONT_DISPLAY};color:${TROMBI_COLORS.accent};">MiGallery</span>
    </div>
    <span data-pdf-text style="position:absolute;right:${g.margin}px;top:${g.margin}px;text-align:right;font:400 11px/16px ${FONT_BODY};color:${TROMBI_COLORS.muted};">${safe(texts.date)}</span>
    <span data-pdf-text style="position:absolute;right:${g.margin}px;top:${g.margin + 16}px;text-align:right;font:400 11px/16px ${FONT_BODY};color:${TROMBI_COLORS.muted};">${safe(texts.subtitle)}</span>
    <div style="position:absolute;left:${g.margin}px;right:${g.margin}px;top:${g.margin + 42}px;height:2px;background:${TROMBI_COLORS.accent};"></div>`;

  const body = placements.map((p) => {
    const section = sections[p.section];
    if (p.kind === 'band') {
      return {
        page: p.page,
        html: `<div style="position:absolute;left:${g.margin}px;right:${g.margin}px;top:${p.y}px;height:${g.bandHeight}px;border-radius:10px;background:${TROMBI_COLORS.accentLight};">
          <span data-pdf-text style="position:absolute;left:16px;top:7px;font:700 16px/20px ${FONT_DISPLAY};color:${TROMBI_COLORS.accent};">${safe(section.label)}</span>
          <span data-pdf-text style="position:absolute;right:16px;top:9px;text-align:right;font:400 11px/16px ${FONT_BODY};color:${TROMBI_COLORS.muted};">${safe(texts.count(section.members.length))}</span>
        </div>`,
      };
    }
    const member = section.members[p.member];
    const name = [member.firstName, member.lastName].filter(Boolean).join(' ') || member.name;
    return {
      page: p.page,
      html: `<div data-trombi-cell style="position:absolute;left:${p.x}px;top:${p.y}px;width:${cw}px;display:flex;flex-direction:column;align-items:center;">
        ${tileHtml(member, g)}
        <p data-pdf-text data-trombi-name style="margin:${g.nameGap}px 0 0 0;width:${cw - 8}px;text-align:center;text-wrap:balance;overflow-wrap:anywhere;font:600 ${g.nameFontPx}px/${nameLinePx}px ${FONT_BODY};color:${TROMBI_COLORS.text};">${safe(name)}</p>
      </div>`,
    };
  });

  const html = Array.from({ length: pages }, (_, i) => {
    const page = i + 1;
    return `<div data-trombi-page style="position:relative;width:${g.pageWidth}px;height:${g.pageHeight}px;overflow:hidden;background:#ffffff;">
      ${header}
      ${body
        .filter((b) => b.page === page)
        .map((b) => b.html)
        .join('')}
      <span data-pdf-text style="position:absolute;left:0;right:0;top:${g.pageHeight - g.margin - 12}px;text-align:center;font:400 10px/14px ${FONT_BODY};color:${TROMBI_COLORS.muted};">${safe(texts.page(page, pages))}</span>
    </div>`;
  }).join('');
  return { html, pages };
}

/**
 * Replaces a member photo that failed to load with the initials tile: the same frame, the same
 * shape. The `<img>` is REMOVED rather than hidden (see {@link tileHtml}).
 */
export function showInitialsInstead(img: HTMLImageElement): void {
  console.debug('[trombi-pdf] a member photo did not load, initials drawn instead');
  const initials = img.parentElement?.querySelector<HTMLElement>('[data-trombi-initials]');
  if (initials) initials.style.display = 'flex';
  img.remove();
}

/**
 * Shortens a name that still takes more than two lines in the browser's own layout, with an ellipsis:
 * the last resort. Measured on the live node, so the decision is the browser's, not a second
 * engine's.
 */
export function clampNameToLines(el: HTMLElement, maxLines: number, lineHeightPx: number): void {
  const limit = lineHeightPx * maxLines + 1;
  if (el.getBoundingClientRect().height <= limit) return;
  const full = el.textContent ?? '';
  let end = full.length;
  while (end > 1 && el.getBoundingClientRect().height > limit) {
    end--;
    el.textContent = full.slice(0, end).trimEnd() + '…';
  }
}

/** Renders the sections to an A4 PDF and downloads it. */
export async function exportTrombinoscope(
  sections: TrombiSectionData[],
  texts: TrombiTexts,
  filename: string,
  g: Geometry = TROMBI_GEOMETRY
): Promise<void> {
  const { exportSearchablePdf } = await import('./pdf/searchable-raster');
  const { html, pages } = buildTrombiHtml(sections, texts, g);

  const container = document.createElement('div');
  Object.assign(container.style, {
    position: 'absolute',
    top: '0',
    left: '-9999px',
    width: `${g.pageWidth}px`,
    background: '#ffffff',
  });
  container.innerHTML = html;

  // A listener and not an `onerror=` attribute (a CSP refuses inline handlers), attached before the
  // container joins the document so an error that fires at once still finds it. Never `on*` on a
  // node this file did not create.
  for (const img of container.querySelectorAll<HTMLImageElement>('img[data-trombi-photo]')) {
    img.addEventListener('error', () => showInitialsInstead(img), { once: true });
  }
  document.body.appendChild(container);
  try {
    await document.fonts.ready;
    const nameLinePx = g.nameFontPx * g.nameLineHeight;
    for (const el of container.querySelectorAll<HTMLElement>('[data-trombi-name]')) {
      clampNameToLines(el, g.nameMaxLines, nameLinePx);
    }
    await exportSearchablePdf(container, {
      filename,
      naturalWidth: g.pageWidth,
      naturalHeight: pages * g.pageHeight,
      rasterScale: 2,
      jpegQuality: 0.92,
      backgroundColor: '#ffffff',
      fonts: ["700 26px 'Space Grotesk'", "600 12px 'Inter'", "400 11px 'Inter'"],
    });
  } finally {
    document.body.removeChild(container);
  }
}
