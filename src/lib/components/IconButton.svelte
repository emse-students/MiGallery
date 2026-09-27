<!--
  IconButton.svelte - a round, transparent 44 px button around one icon (Google Photos' header and
  pager buttons). The label is required: an icon alone announces nothing, so it becomes both the
  accessible name and the tooltip.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    label: string;
    onclick: () => void;
    disabled?: boolean;
    /** A toggle that is on (the open search). */
    active?: boolean;
    /** `aria-expanded`, for a button that opens a region. */
    expanded?: boolean;
    children: Snippet;
  }

  let { label, onclick, disabled = false, active = false, expanded, children }: Props = $props();
</script>

<button
  type="button"
  class="icon-button"
  class:active
  {onclick}
  {disabled}
  aria-label={label}
  aria-expanded={expanded}
  title={label}
>
  {@render children()}
</button>

<style>
  /* Stated in full: the global `button` rule would give it a filled background. */
  .icon-button {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--text-primary);
    cursor: pointer;
  }

  .icon-button:hover:not(:disabled),
  .icon-button.active {
    background: color-mix(in srgb, var(--text-primary) 10%, transparent);
  }

  .icon-button:disabled {
    opacity: 0.35;
    cursor: default;
  }
</style>
