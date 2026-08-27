/**
 * Browsing state of the albums page, held in module scope so that opening an
 * album and coming back lands the user exactly where they left: same search,
 * same school years unfolded, same scroll offset.
 *
 * It is deliberately NOT persisted to storage. A fresh load of /albums (reload,
 * new tab, navbar link) starts from the top with the default folding, which is
 * what a user asking for the albums page expects; only a return trip restores.
 */
class AlbumsViewState {
  /** Live search box content. */
  search = $state('');
  /** Per school-year override of the default folding, keyed by group key. */
  expandedYears = $state<Record<string, boolean>>({});

  /**
   * Last known window offset of the albums page. Plain field, not $state:
   * it is written on every scroll event and never read during render.
   */
  scrollY = 0;

  /** One-shot flag: set when leaving for an album, consumed on the way back. */
  #returning = false;

  /** Call before navigating from the albums page into an album. */
  markReturnTrip() {
    this.#returning = true;
  }

  /**
   * True once per return trip. Browser back is left alone: SvelteKit restores
   * the scroll itself there, and doing it twice would fight it.
   */
  consumeReturnTrip(): boolean {
    const returning = this.#returning;
    this.#returning = false;
    return returning;
  }
}

export const albumsView = new AlbumsViewState();
