/**
 * "Searchable raster" PDF exporter, ported from Canari (`frontend/src/lib/pdf/searchableRaster.ts`),
 * reduced to what MiGallery needs (no emoji pass, no rotated stamps).
 *
 * The element's visuals (tiles, photos, bands) are rasterised once as a page background, with every
 * `data-pdf-text` node transparent for that pass; those nodes are then re-drawn on top as REAL
 * vector text in the embedded app fonts. The PDF is pixel-faithful, sharp at any zoom, and
 * selectable / searchable, with no double text.
 *
 * WHERE A LINE BREAKS IS THE BROWSER'S ANSWER, READ AND NEVER RE-DERIVED. A wrapped run is measured
 * line by line ({@link groupCharsIntoLines}) and each line is drawn at its own baseline. jsPDF's
 * `splitTextToSize` measures in its own metrics and broke a name mid-word in Canari, so it is not
 * used.
 *
 * MARKUP CONTRACT: put `data-pdf-text` on the element whose box IS the text's line box (a `<p>` or a
 * bare `<span>`, not a padded or flex-centred container): a run is anchored to the measured
 * baseline of its first line.
 */
import { rasterizeElementToCanvas } from './raster';
import { registerAppFonts, pickAppFont } from './app-fonts';

/** One measured character: its glyph box, or null where the browser gave it no box. */
export interface MeasuredChar {
  ch: string;
  rect: { top: number; left: number; right: number; height: number } | null;
}

/** A line, in the coordinate space it was measured in. */
export interface GroupedLine {
  text: string;
  left: number;
  right: number;
  top: number;
}

/**
 * Groups per-character boxes into the lines the browser produced. A new line starts where a box
 * steps DOWN by more than half a glyph height: the one signal that survives centring, justification
 * and a hanging trailing space. A character with no box (the collapsed space at a wrap) joins the
 * current line and is trimmed. Pure so a test can pin it down: jsdom lays nothing out.
 */
export function groupCharsIntoLines(chars: MeasuredChar[]): GroupedLine[] {
  const lines: GroupedLine[] = [];
  let current: GroupedLine | null = null;
  for (const { ch, rect } of chars) {
    if (!rect || (rect.height === 0 && rect.right === rect.left)) {
      if (current) current.text += ch;
      continue;
    }
    if (current === null || rect.top - current.top > Math.max(1, rect.height * 0.5)) {
      current = { text: ch, left: rect.left, right: rect.right, top: rect.top };
      lines.push(current);
      continue;
    }
    current.text += ch;
    if (ch.trim() !== '') {
      current.left = Math.min(current.left, rect.left);
      current.right = Math.max(current.right, rect.right);
    }
  }
  return lines.map((l) => ({ ...l, text: l.text.trim() })).filter((l) => l.text !== '');
}

/** Reads the lines a run was laid out on, via one Range per character. Empty when nothing is laid out. */
function measureLineBoxes(el: HTMLElement): GroupedLine[] {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const chars: MeasuredChar[] = [];
  const range = document.createRange();
  let measured = false;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const data = (node as Text).data;
    for (let i = 0; i < data.length; i++) {
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const r = range.getBoundingClientRect();
      const empty = r.width === 0 && r.height === 0;
      if (!empty) measured = true;
      chars.push({
        ch: data[i],
        rect: empty ? null : { top: r.top, left: r.left, right: r.right, height: r.height },
      });
    }
  }
  return measured ? groupCharsIntoLines(chars) : [];
}

/** The first line's alphabetic baseline, MEASURED with a zero-size inline-block, never estimated. */
function measureBaseline(el: HTMLElement): { x: number; y: number } {
  const probe = document.createElement('span');
  probe.style.cssText =
    'display:inline-block;width:0;height:0;margin:0;padding:0;border:0;vertical-align:baseline;';
  el.prepend(probe);
  const r = probe.getBoundingClientRect();
  probe.remove();
  return { x: r.left, y: r.top };
}

function parseRgb(css: string): { r: number; g: number; b: number } {
  const m = css.match(/rgba?\(([^)]+)\)/);
  if (!m) return { r: 0, g: 0, b: 0 };
  const [r, g, b] = m[1].split(',').map((p) => parseInt(p.trim(), 10));
  return { r: r || 0, g: g || 0, b: b || 0 };
}

function applyTextTransform(text: string, textTransform: string): string {
  if (textTransform === 'uppercase') return text.toUpperCase();
  if (textTransform === 'lowercase') return text.toLowerCase();
  return text;
}

interface LineBox {
  text: string;
  left: number;
  right: number;
  baselineY: number;
}

interface TextSpec {
  x: number;
  y: number;
  w: number;
  h: number;
  baselineY: number;
  fontPx: number;
  align: 'left' | 'center' | 'right';
  family: string;
  weight: number;
  color: { r: number; g: number; b: number };
  letterSpacingPx: number;
  text: string;
  /** The lines the browser broke the run into; empty for a run that fits one line. */
  lines: LineBox[];
}

function collectTextSpecs(root: HTMLElement, naturalWidth: number): TextSpec[] {
  const rootRect = root.getBoundingClientRect();
  const k = rootRect.width > 0 ? naturalWidth / rootRect.width : 1;
  const specs: TextSpec[] = [];
  for (const el of root.querySelectorAll<HTMLElement>('[data-pdf-text]')) {
    const raw = (el.textContent ?? '').trim();
    if (!raw) continue;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const align =
      cs.textAlign === 'center' ? 'center' : cs.textAlign === 'right' ? 'right' : 'left';
    const parsedWeight = parseInt(cs.fontWeight, 10);
    const fontPx = parseFloat(cs.fontSize);
    const lh = cs.lineHeight !== 'normal' ? parseFloat(cs.lineHeight) : fontPx * 1.15;
    const ls = cs.letterSpacing !== 'normal' ? parseFloat(cs.letterSpacing) : 0;
    const base = measureBaseline(el);
    const h = r.height * k;
    const wraps = h > lh * k * 1.2;
    const measured = wraps ? measureLineBoxes(el) : [];
    if (wraps && measured.length === 0) {
      console.warn('[searchable-raster] a run wraps but no line box was read', raw.slice(0, 40));
    }
    const baselineFromTop = measured.length > 0 ? base.y - measured[0].top : 0;
    specs.push({
      x: (r.left - rootRect.left) * k,
      y: (r.top - rootRect.top) * k,
      w: r.width * k,
      h,
      baselineY: (base.y - rootRect.top) * k,
      fontPx: fontPx * k,
      align,
      family: cs.fontFamily,
      weight: Number.isFinite(parsedWeight) ? parsedWeight : 400,
      color: parseRgb(cs.color),
      letterSpacingPx: (Number.isFinite(ls) ? ls : 0) * k,
      text: applyTextTransform(raw, cs.textTransform),
      lines: measured.map((l) => ({
        text: applyTextTransform(l.text, cs.textTransform),
        left: (l.left - rootRect.left) * k,
        right: (l.right - rootRect.left) * k,
        baselineY: (l.top + baselineFromTop - rootRect.top) * k,
      })),
    });
  }
  return specs;
}

/** Options for {@link exportSearchablePdf}. */
export interface SearchablePdfOptions {
  /** Base filename (sanitised; ".pdf" appended). */
  filename: string;
  /** Natural pixel width of the element; maps DOM boxes to mm. */
  naturalWidth: number;
  /** Natural pixel height of the element: a whole number of A4 pages. */
  naturalHeight: number;
  rasterScale?: number;
  jpegQuality?: number;
  fonts?: string[];
  backgroundColor?: string;
}

const PT_PER_MM = 1 / (25.4 / 72);

/**
 * Exports `el` as an A4 portrait searchable-raster PDF. The element is exactly N pages tall, so the
 * raster is sliced on page boundaries: the caller decides where a page ends (and never splits a
 * cell); this only cuts where it is told.
 */
export async function exportSearchablePdf(
  el: HTMLElement,
  opts: SearchablePdfOptions
): Promise<void> {
  const { default: jsPDF } = await import('jspdf');
  const specs = collectTextSpecs(el, opts.naturalWidth);

  // Hidden for the raster by a stylesheet (not inline styles, which a reactive framework may re-apply
  // during the async raster); the glyphs go, so the vector re-draw is the only text.
  const styleEl = document.createElement('style');
  styleEl.textContent =
    '.pdf-exporting-raster [data-pdf-text]{color:rgba(0,0,0,0) !important;-webkit-text-fill-color:rgba(0,0,0,0) !important;}';
  document.head.appendChild(styleEl);
  el.classList.add('pdf-exporting-raster');
  let canvas: HTMLCanvasElement;
  try {
    canvas = await rasterizeElementToCanvas(el, {
      scale: opts.rasterScale ?? 2,
      fonts: opts.fonts,
      backgroundColor: opts.backgroundColor,
    });
  } finally {
    el.classList.remove('pdf-exporting-raster');
    styleEl.remove();
  }

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  await registerAppFonts(pdf);

  const mmPerPx = pageW / opts.naturalWidth;
  const pagePxH = pageH / mmPerPx;
  const totalPages = Math.max(1, Math.round(opts.naturalHeight / pagePxH));
  const rasterScale = canvas.width / opts.naturalWidth;

  for (let p = 0; p < totalPages; p++) {
    if (p > 0) pdf.addPage();
    const srcY = Math.round(p * pagePxH * rasterScale);
    const srcH = Math.min(Math.round(pagePxH * rasterScale), canvas.height - srcY);
    if (srcH <= 0) continue;
    const slice = document.createElement('canvas');
    slice.width = canvas.width;
    slice.height = srcH;
    slice
      .getContext('2d')!
      .drawImage(canvas, 0, srcY, canvas.width, srcH, 0, 0, canvas.width, srcH);
    pdf.addImage(
      slice.toDataURL('image/jpeg', opts.jpegQuality ?? 0.92),
      'JPEG',
      0,
      0,
      pageW,
      (srcH / rasterScale) * mmPerPx
    );
    const top = p * pagePxH;
    drawTextSpecs(
      pdf,
      specs.filter((s) => s.y + s.h / 2 >= top && s.y + s.h / 2 < top + pagePxH),
      mmPerPx,
      -top
    );
  }

  const safe = opts.filename.replace(/[^a-zA-Z0-9À-ž\- ]/g, '_').trim() || 'export';
  pdf.save(`${safe}.pdf`);
}

function drawTextSpecs(
  pdf: import('jspdf').jsPDF,
  specs: TextSpec[],
  mmPerPx: number,
  yOffset: number
): void {
  for (const s of specs) {
    const font = pickAppFont(s.family, s.weight);
    if (font) pdf.setFont(font.name, font.style);
    else {
      console.warn('[searchable-raster] family not embedded, Helvetica used', s.family);
      pdf.setFont('helvetica', s.weight >= 600 ? 'bold' : 'normal');
    }
    pdf.setFontSize(s.fontPx * mmPerPx * PT_PER_MM);
    pdf.setTextColor(s.color.r, s.color.g, s.color.b);
    const charSpace = s.letterSpacingPx * mmPerPx;

    if (s.lines.length > 0) {
      // The browser already broke this run: each line at its own measured baseline.
      for (const line of s.lines) {
        const anchor =
          s.align === 'center'
            ? (line.left + line.right) / 2
            : s.align === 'right'
              ? line.right
              : line.left;
        pdf.text(line.text, anchor * mmPerPx, (line.baselineY + yOffset) * mmPerPx, {
          align: s.align,
          charSpace,
        });
      }
      continue;
    }
    // One line: nothing to decide.
    const anchorX = s.align === 'center' ? s.x + s.w / 2 : s.align === 'right' ? s.x + s.w : s.x;
    pdf.text(s.text, anchorX * mmPerPx, (s.baselineY + yOffset) * mmPerPx, {
      align: s.align,
      charSpace,
    });
  }
}
