/**
 * DOM-to-canvas rasteriser for the client-side PDF exports, ported from Canari
 * (`frontend/src/lib/utils/pdfRaster.ts`).
 *
 * snapdom serialises the subtree into an SVG `<foreignObject>` and lets the browser's own engine
 * paint it, so flexbox, `text-wrap: balance` and the web fonts render exactly as on screen.
 */

/** Options for {@link rasterizeElementToCanvas}. */
export interface RasterizeOptions {
  /** Output scale multiplier. Default 2. */
  scale?: number;
  backgroundColor?: string;
  /** `document.fonts.load()` shorthands to force-load before the capture. */
  fonts?: string[];
}

/**
 * Rasterises a live, attached element. The caller owns its lifecycle (offscreen, then removed).
 *
 * `addEventListener`, NEVER `img.onerror = ...`: a property assignment would replace the call
 * site's own handler (Canari lost its initials fallback that way). A node the caller did not
 * create is never given an `on*` property.
 */
export async function rasterizeElementToCanvas(
  el: HTMLElement,
  opts: RasterizeOptions = {}
): Promise<HTMLCanvasElement> {
  const { scale = 2, backgroundColor, fonts = [] } = opts;

  const images = Array.from(el.querySelectorAll<HTMLImageElement>('img'));
  await Promise.all(
    images.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete) return resolve();
          img.addEventListener('load', () => resolve(), { once: true });
          img.addEventListener('error', () => resolve(), { once: true });
        })
    )
  );

  if (fonts.length > 0) {
    await Promise.all(fonts.map((f) => document.fonts.load(f))).catch((e) => {
      console.warn('[pdf-raster] font preload failed', e);
    });
  }
  await document.fonts.ready;

  // Dynamic import keeps snapdom out of the main bundle.
  const { snapdom } = await import('@zumer/snapdom');
  // `placeholders: false`: snapdom otherwise substitutes every <img> it cannot inline - a hidden
  // one included - with a grey in-flow box reading "img". A member without a photo REMOVES its
  // <img> instead (see `showInitialsInstead`).
  return snapdom.toCanvas(el, { scale, backgroundColor, embedFonts: true, placeholders: false });
}
