<!--
  PageHeader.svelte - the one page header (ui-redesign #16).

  Google Photos' shape, measured on the albums list: a left-aligned title (with an optional
  subtitle), an optional leading element (Mes photos' face), and the page's actions as round icon
  buttons (`IconButton`) on the right.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { fade } from 'svelte/transition';

  interface Props {
    title: string;
    subtitle?: string;
    /** Drawn before the title (an avatar). */
    leading?: Snippet;
    /** Drawn under the title (a badge). */
    below?: Snippet;
    /** Icon buttons on the right. */
    actions?: Snippet;
  }

  let { title, subtitle, leading, below, actions }: Props = $props();
</script>

<header class="page-header" in:fade={{ duration: 300, delay: 100 }}>
  {#if leading}{@render leading()}{/if}
  <div class="page-header-text">
    <h1>{title}</h1>
    {#if subtitle}<p class="page-header-subtitle">{subtitle}</p>{/if}
    {#if below}{@render below()}{/if}
  </div>
  {#if actions}
    <div class="page-header-actions">{@render actions()}</div>
  {/if}
</header>

<style>
  .page-header {
    display: flex;
    flex-wrap: nowrap;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1.25rem;
  }

  .page-header-text {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.15rem;
    min-width: 0;
  }

  .page-header h1 {
    margin: 0;
    overflow: hidden;
    font-size: 1.75rem;
    line-height: 1.2;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
    width: auto;
  }

  .page-header-subtitle {
    margin: 0;
    color: var(--text-secondary);
    font-size: 0.9rem;
  }

  .page-header-actions {
    display: flex;
    flex-shrink: 0;
    gap: 0.25rem;
  }

  @media (max-width: 640px) {
    .page-header {
      margin-bottom: 0.75rem;
    }

    .page-header h1 {
      font-size: 1.5rem;
    }
  }
</style>
