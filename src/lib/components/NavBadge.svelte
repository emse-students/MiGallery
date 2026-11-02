<!--
  NavBadge.svelte - the count on a navigation tab (the faces waiting for the member's answer).

  Drawn over the tab's glyph by `SideNav` and `MobileNav`, which give its parent `position:
  relative`. The number is decoration; the sentence is for a screen reader. Nothing when the count
  is 0.
-->
<script lang="ts">
  import { m } from '#lib/paraglide/messages.js';

  let { count }: { count: number } = $props();

  let text = $derived(count > 99 ? '99+' : String(count));
</script>

{#if count > 0}
  <span class="nav-badge" aria-hidden="true">{text}</span>
  <span class="sr-only">{m.mpc_count({ count })}</span>
{/if}

<style>
  .nav-badge {
    position: absolute;
    top: -0.35rem;
    right: -0.6rem;
    min-width: 1.1rem;
    height: 1.1rem;
    padding: 0 0.3rem;
    border-radius: 999px;
    background: var(--accent);
    color: white;
    font-size: 0.6875rem;
    font-weight: 700;
    line-height: 1.1rem;
    text-align: center;
    pointer-events: none;
  }
</style>
