/**
 * MiGallery's fonts (Space Grotesk for headings, Inter for the body - `src/app.css`) embedded into
 * jsPDF, so the vector text of the exports matches the page instead of jsPDF's Helvetica.
 *
 * jsPDF embeds static TrueType only, not the web page's variable families, so the static `.ttf`
 * files are served from `static/fonts/pdf/` (SIL OFL, from Google Fonts) and fetched, then
 * base64-embedded, only when a PDF is exported. Same role as Canari's `appFonts.ts`.
 */
import type { jsPDF } from 'jspdf';

interface AppFont {
  file: string;
  name: string;
  style: 'normal' | 'bold';
}

const APP_FONTS: AppFont[] = [
  { file: 'Inter-Regular.ttf', name: 'Inter', style: 'normal' },
  // jsPDF knows two styles per name: the 600 weight the sheet uses stands in as "bold".
  { file: 'Inter-SemiBold.ttf', name: 'Inter', style: 'bold' },
  { file: 'SpaceGrotesk-Bold.ttf', name: 'SpaceGrotesk', style: 'bold' },
];

async function fetchFontBase64(url: string): Promise<string> {
  const res = await fetch(url).catch((e) => {
    console.error('[pdf-fonts] font fetch failed', url, e);
    throw e;
  });
  if (!res.ok) {
    console.error('[pdf-fonts] font fetch refused', url, res.status);
    throw new Error(`pdf font ${url}: HTTP ${res.status}`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  let binary = '';
  // Chunked to stay under the argument-count limit of String.fromCharCode.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** Fetches and registers every font in a jsPDF document. Throws when one is missing: no fallback. */
export async function registerAppFonts(pdf: jsPDF, baseUrl = '/fonts/pdf/'): Promise<void> {
  await Promise.all(
    APP_FONTS.map(async (f) => {
      pdf.addFileToVFS(f.file, await fetchFontBase64(baseUrl + f.file));
      pdf.addFont(f.file, f.name, f.style);
    })
  );
}

/**
 * Maps a computed `font-family` stack and numeric weight to the embedded (name, style), or null for
 * a family that is not embedded. The stack is read in ORDER, one family at a time, the way the
 * browser resolves it: searching the whole string let a fallback win in Canari (2026-09-27).
 */
export function pickAppFont(
  family: string,
  weight: number
): { name: string; style: 'normal' | 'bold' } | null {
  for (const raw of family.split(',')) {
    const f = raw
      .trim()
      .replace(/^['"]|['"]$/g, '')
      .toLowerCase();
    if (f.startsWith('space grotesk')) return { name: 'SpaceGrotesk', style: 'bold' };
    if (f.startsWith('inter')) return { name: 'Inter', style: weight >= 600 ? 'bold' : 'normal' };
  }
  return null;
}
