/**
 * The album page's header (ui-redesign D10) and blurred cover background (D11): which image
 * each one loads, and the date line under the title.
 *
 * PURE, so `tests/album-hero.test.ts` pins it.
 */

/** What the page knows about the album when it draws its header. */
export interface AlbumHeroInput {
  albumId: string;
  /** The persisted cover (`albums.cover_asset_id`), or null when Immich gave none either. */
  coverAssetId?: string | null;
  visibility?: string | null;
}

export interface AlbumHeroSources {
  /**
   * The phone hero: the cover's `preview` (1440 px on the long side). The hero is ~54 % of a
   * phone screen - on the Mi 9T 460 CSS px tall, ~1265 device px - so the grid's 600x400
   * `thumbnail` would be upscaled ~3x; one preview per album opened is the price, the same the
   * viewer pays per photo. Null without a cover.
   */
  hero: string | null;
  /**
   * The blurred background: the album's 400x400 cover, disk-cached and `immutable` once
   * versioned. Blurred at 48 px, it has more pixels than it will ever show. Null without a cover.
   */
  backdrop: string | null;
}

/** The two image URLs of the album header. An unlisted album's visitor goes through its route. */
export function albumHeroSources(input: AlbumHeroInput): AlbumHeroSources {
  const cover = input.coverAssetId;
  if (!cover) return { hero: null, backdrop: null };
  const id = encodeURIComponent(input.albumId);
  const asset = encodeURIComponent(cover);
  const hero =
    input.visibility === 'unlisted'
      ? `/api/albums/${id}/asset-thumbnail/${asset}/thumbnail?size=preview`
      : `/api/immich/assets/${asset}/thumbnail?size=preview`;
  return { hero, backdrop: `/api/albums/${id}/cover?v=${asset}` };
}

/**
 * The album's date as the header prints it ("13 sept. 2025"), or null. `date` is the stored
 * `YYYY-MM-DD`; it is read at noon so no time zone moves it to the day before.
 */
export function formatAlbumDate(date: string | null | undefined, locale: string): string | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const d = new Date(`${date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(locale === 'fr' ? 'fr-FR' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
