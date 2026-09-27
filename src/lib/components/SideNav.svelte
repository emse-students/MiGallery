<!--
  SideNav.svelte - the desktop navigation, Google Photos' left sidebar (ui-redesign #9).

  Above 768 px it replaces the phone's bottom bar: a 256 px drawer of icon + label rows from
  1100 px, a narrow rail of icons over small labels between 769 and 1099 px (a tablet, or a
  half-screen window). Hidden entirely on a phone. It draws the same `NAV_ITEMS` as `MobileNav`.
  Flat and transparent like Google Photos' own: the page shows through, and only the active
  row carries a tint.
-->
<script lang="ts">
  import { page } from '$app/state';
  import type { User } from '$lib/types/api';
  import { NAV_ITEMS, isNavActive } from '$lib/nav-items';
  import { m } from '$lib/paraglide/messages';

  let user = $derived(page.data?.session?.user as User | undefined);
  let currentPath = $derived(page.url.pathname);
</script>

{#if user}
  <nav class="side-nav" aria-label={m.nav_main_aria()}>
    {#each NAV_ITEMS as item (item.href)}
      {@const active = isNavActive(currentPath, item.href)}
      <a
        href={item.href}
        class="side-item"
        class:active
        aria-current={active ? 'page' : undefined}
        data-sveltekit-preload-data
      >
        <span class="side-icon"><item.icon size={20} /></span>
        <span class="side-label">{item.label()}</span>
      </a>
    {/each}
  </nav>
{/if}

<style>
  .side-nav {
    display: none;
    position: fixed;
    top: var(--topbar-height);
    left: 0;
    bottom: 0;
    z-index: 40;
    width: var(--sidenav-width);
    flex-direction: column;
    gap: 0.125rem;
    padding: 0.75rem 0.75rem 1rem;
    overflow-y: auto;
  }

  @media (min-width: 769px) {
    .side-nav {
      display: flex;
    }
  }

  .side-item {
    display: flex;
    align-items: center;
    gap: 1rem;
    height: 2.75rem;
    padding: 0 1rem;
    border-radius: 999px;
    color: var(--text-secondary);
    font-size: 0.875rem;
    font-weight: 500;
    text-decoration: none;
    transition:
      background 0.15s ease,
      color 0.15s ease;
  }

  .side-item:hover {
    background: color-mix(in srgb, var(--text-primary) 6%, transparent);
    color: var(--text-primary);
  }

  .side-item.active {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    color: var(--accent);
    font-weight: 600;
  }

  .side-icon {
    display: flex;
    flex-shrink: 0;
  }

  /* The rail: icon in a pill, label underneath (Material's navigation rail). */
  @media (min-width: 769px) and (max-width: 1099px) {
    .side-nav {
      align-items: center;
      gap: 0.75rem;
      padding: 0.75rem 0.25rem;
    }

    .side-item,
    .side-item:hover,
    .side-item.active {
      flex-direction: column;
      gap: 0.25rem;
      width: 100%;
      height: auto;
      padding: 0;
      background: none;
      font-size: 0.6875rem;
    }

    .side-icon {
      justify-content: center;
      width: 3.5rem;
      height: 2rem;
      border-radius: 999px;
      transition: background 0.15s ease;
    }

    .side-item:hover .side-icon {
      background: color-mix(in srgb, var(--text-primary) 6%, transparent);
    }

    .side-item.active .side-icon {
      background: color-mix(in srgb, var(--accent) 14%, transparent);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .side-item,
    .side-icon {
      transition: none;
    }
  }
</style>
