<!--
  SettingsRow.svelte - one row of the settings list (ui-redesign #18).

  Google Photos' settings shape: an icon, a title with an optional one-line description, and on the
  right either a control (the `children` snippet) or a chevron when the whole row is the action.
  The element follows the row's job - a link for `href`, a button for `onclick`, a plain block
  around a control - so the whole row is the hit target exactly when it does one thing.
-->
<script lang="ts">
  import type { Component, Snippet } from 'svelte';
  import { ChevronRight } from '@lucide/svelte';

  interface Props {
    icon?: Component;
    title: string;
    description?: string;
    /** The row navigates. */
    href?: string;
    /** The row acts. */
    onclick?: () => void;
    disabled?: boolean;
    /** An irreversible action: red title and icon. */
    danger?: boolean;
    /** The control on the right; a row without one and with an action shows a chevron. */
    children?: Snippet;
  }

  let {
    icon: Icon,
    title,
    description,
    href,
    onclick,
    disabled = false,
    danger = false,
    children,
  }: Props = $props();
</script>

{#snippet body()}
  {#if Icon}
    <span class="row-icon"><Icon size={20} /></span>
  {/if}
  <span class="row-text">
    <span class="row-title">{title}</span>
    {#if description}
      <span class="row-desc">{description}</span>
    {/if}
  </span>
  {#if children}
    <span class="row-control">{@render children()}</span>
  {:else if href || onclick}
    <span class="row-chevron"><ChevronRight size={18} /></span>
  {/if}
{/snippet}

{#if href && !disabled}
  <a {href} class="settings-row actionable" class:danger>{@render body()}</a>
{:else if onclick}
  <button type="button" class="settings-row actionable" class:danger {onclick} {disabled}>
    {@render body()}
  </button>
{:else}
  <div class="settings-row" class:danger class:disabled>{@render body()}</div>
{/if}

<style>
  .settings-row {
    display: flex;
    align-items: center;
    gap: 1rem;
    width: 100%;
    min-height: 3.5rem;
    padding: 0.75rem 1rem;
    border: none;
    border-radius: 0;
    background: none;
    color: var(--text-primary);
    font: inherit;
    text-align: left;
    text-decoration: none;
  }

  /* `app.css` centres every button's content; a row reads left to right. */
  button.settings-row {
    justify-content: flex-start;
  }

  .actionable {
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .actionable:hover:not(:disabled) {
    background: color-mix(in srgb, var(--text-primary) 5%, transparent);
  }

  .actionable:disabled,
  .disabled {
    cursor: default;
    opacity: 0.55;
  }

  .row-icon {
    display: flex;
    flex-shrink: 0;
    color: var(--text-secondary);
  }

  .row-text {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 0.125rem;
    min-width: 0;
  }

  .row-title {
    font-size: 0.9375rem;
    font-weight: 500;
  }

  .row-desc {
    color: var(--text-secondary);
    font-size: 0.8125rem;
    line-height: 1.35;
  }

  .row-control {
    display: flex;
    flex-shrink: 0;
    align-items: center;
  }

  .row-chevron {
    display: flex;
    flex-shrink: 0;
    color: var(--text-muted);
  }

  .danger .row-title,
  .danger .row-icon {
    color: var(--error);
  }

  @media (prefers-reduced-motion: reduce) {
    .actionable {
      transition: none;
    }
  }
</style>
