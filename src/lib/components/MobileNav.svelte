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
      <a
        href={item.href}
        class="nav-item"
        class:active={isNavActive(currentPath, item.href)}
        aria-current={isNavActive(currentPath, item.href) ? 'page' : undefined}
        data-sveltekit-preload-data
      >
        <item.icon size={24} />
        <span class="nav-label">{item.label()}</span>
      </a>
    {/each}
  </nav>
{/if}

<style>
  .mobile-nav {
    display: none; /* the sidebar carries navigation above 768 px */
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    width: 100%;
    /* Same material as the top bar (app.css `.topbar`): photos scroll under both. */
    background: color-mix(in srgb, var(--bg-primary) 70%, transparent);
    -webkit-backdrop-filter: blur(20px) saturate(1.3);
    backdrop-filter: blur(20px) saturate(1.3);
    border-top: 1px solid var(--surface-border);
    padding: 0.5rem 0;
    padding-bottom: calc(0.5rem + env(safe-area-inset-bottom, 0px)); /* iPhone notch support */
    z-index: 1000;
    box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.15);
  }

  @media (max-width: 768px) {
    .mobile-nav {
      display: flex;
      justify-content: space-around;
      align-items: center;
    }
  }

  .nav-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    padding: 0.5rem 0.75rem;
    color: var(--text-muted);
    text-decoration: none;
    border-radius: var(--radius-sm);
    transition: all 0.2s ease;
    min-width: 60px;
  }

  .nav-item:hover {
    color: var(--text-secondary);
  }

  .nav-item.active {
    color: var(--accent);
  }

  .nav-label {
    font-size: 0.625rem;
    font-weight: 500;
    letter-spacing: 0.01em;
    text-align: center;
  }

  /* Tap animation */
  .nav-item:active {
    transform: scale(0.95);
  }
</style>
