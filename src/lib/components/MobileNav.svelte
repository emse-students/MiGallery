<!--
  MobileNav.svelte - the phone's bottom navigation bar (<= 768 px).

  Above that width the desktop sidebar (`SideNav`) carries the same destinations; both draw
  `NAV_ITEMS`. Hidden on an album page, whose cover hero owns the phone screen.
-->
<script lang="ts">
  import { page } from '$app/state';
  import type { User } from '$lib/types/api';
  import { NAV_ITEMS, isNavActive } from '$lib/nav-items';
  import { m } from '$lib/paraglide/messages';

  let user = $derived(page.data?.session?.user as User | undefined);
  let isAuthenticated = $derived(!!user);

  let currentPath = $derived(page.url.pathname);

  let isAlbumDetailPage = $derived(
    currentPath.startsWith('/albums/') && currentPath !== '/albums/'
  );
</script>

{#if isAuthenticated && !isAlbumDetailPage}
  <nav class="mobile-nav" aria-label={m.nav_main_aria()}>
    {#each NAV_ITEMS as item (item.href)}
      {@const active = isNavActive(currentPath, item.href)}
      <a
        href={item.href}
        class="nav-item"
        class:active
        aria-current={active ? 'page' : undefined}
        data-sveltekit-preload-data
      >
        <!-- The glyph alone is drawn; the full name stays the tab's accessible name. -->
        <item.icon size={24} strokeWidth={active ? 2.5 : 2} aria-hidden="true" />
        <span class="sr-only">{item.label()}</span>
      </a>
    {/each}
  </nav>
{/if}

<style>
  /*
   * Instagram's bar, measured on the Mi 9T (Canari design-reference section 23): 48 px plus the
   * safe-area inset, a 24 px glyph, no label under it, every target at least 44 px, and the active
   * tab marked by the glyph alone (tint and a heavier stroke - no underline, no glow).
   * `--mobile-nav-height` in app.css is this height; keep the two in step.
   */
  .mobile-nav {
    display: none; /* the sidebar carries navigation above 768 px */
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    width: 100%;
    /* Same material as the top bar (app.css `.topbar`): opaque page colour and a hairline, no
       glass and no shadow (ui-redesign #25). */
    background: var(--bg-primary);
    border-top: 1px solid var(--surface-border);
    padding-bottom: env(safe-area-inset-bottom, 0px); /* iPhone home indicator */
    z-index: 1000;
  }

  @media (max-width: 768px) {
    .mobile-nav {
      display: flex;
      align-items: stretch;
    }
  }

  .nav-item {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 48px;
    min-width: 44px;
    color: var(--text-muted);
    text-decoration: none;
    transition: color 0.2s ease;
    -webkit-tap-highlight-color: transparent;
  }

  .nav-item:hover {
    color: var(--text-secondary);
  }

  .nav-item.active {
    color: var(--accent);
  }

  .nav-item:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -4px;
    border-radius: var(--radius-sm);
  }
</style>
