<script lang="ts">
  /**
   * The three-dot overflow menu: the ONE place a destructive action may live (decision D4,
   * `docs/wiki/ui-redesign.md`).
   *
   * Accessibility follows the WAI-ARIA menu button pattern: the trigger carries
   * `aria-haspopup="menu"` / `aria-expanded`, opening focuses the first entry, the arrows,
   * Home and End move focus, Escape and Tab close, and focus returns to the trigger after an
   * Escape or a selection. The menu is portalled to `<body>` with fixed coordinates, because
   * its hosts (album cards, photo tiles) clip their children (`overflow: hidden`, masks,
   * transforms) and sit under the viewer's stacking context.
   */
  import { tick } from 'svelte';
  import { EllipsisVertical } from '@lucide/svelte';
  import { m } from '$lib/paraglide/messages';
  import { nextMenuIndex, type OverflowMenuItem } from '$lib/overflow-menu';
  import { portal } from '$lib/portal';

  interface Props {
    items: OverflowMenuItem[];
    /** Accessible name and tooltip of the trigger; defaults to "More options". */
    label?: string;
    /**
     * Look of the trigger: `overlay` over imagery (dark chip), `toolbar` in the viewer's
     * toolbar, `bar` for a host that styles it through `triggerClass` (e.g. the global `.btn`).
     */
    variant?: 'overlay' | 'toolbar' | 'bar';
    /** Extra classes on the trigger; global ones only (component styles are scoped). */
    triggerClass?: string;
    /** Shows the label as text next to the icon. */
    showLabel?: boolean;
    iconSize?: number;
  }

  let {
    items,
    label = m.common_more_actions(),
    variant = 'overlay',
    triggerClass = '',
    showLabel = false,
    iconSize = 20,
  }: Props = $props();

  const menuId = `overflow-menu-${Math.random().toString(36).slice(2, 10)}`;
  /** Gap between the trigger and the menu, and the menu's minimum distance to the viewport. */
  const MENU_GAP = 4;
  const VIEWPORT_MARGIN = 8;

  let open = $state(false);
  let triggerElement = $state<HTMLButtonElement | null>(null);
  let menuElement = $state<HTMLDivElement | null>(null);
  let position = $state({ top: 0, right: 0 });

  function itemButtons(): HTMLButtonElement[] {
    return menuElement ? Array.from(menuElement.querySelectorAll('[role="menuitem"]')) : [];
  }

  function focusItem(index: number) {
    if (index >= 0) itemButtons()[index]?.focus();
  }

  /** Places the menu right-aligned under the trigger, or above it when it would overflow. */
  function place() {
    if (!triggerElement) return;
    const rect = triggerElement.getBoundingClientRect();
    const right = Math.max(VIEWPORT_MARGIN, window.innerWidth - rect.right);
    let top = rect.bottom + MENU_GAP;
    const height = menuElement?.offsetHeight ?? 0;
    if (top + height > window.innerHeight - VIEWPORT_MARGIN) {
      top = Math.max(VIEWPORT_MARGIN, rect.top - MENU_GAP - height);
    }
    position = { top, right };
  }

  async function openMenu() {
    open = true;
    place();
    await tick();
    place();
    focusItem(
      nextMenuIndex(
        -1,
        1,
        items.map((i) => !!i.disabled)
      )
    );
  }

  function closeMenu(returnFocus: boolean) {
    if (!open) return;
    open = false;
    if (returnFocus) triggerElement?.focus();
  }

  function handleTriggerClick(e: MouseEvent) {
    // Hosts are clickable themselves (a photo tile opens the viewer): the trigger is not.
    e.stopPropagation();
    e.preventDefault();
    if (open) closeMenu(true);
    else void openMenu();
  }

  function select(item: OverflowMenuItem, e: MouseEvent) {
    e.stopPropagation();
    if (item.disabled) return;
    closeMenu(true);
    item.onSelect();
  }

  function handleMenuKeydown(e: KeyboardEvent) {
    const buttons = itemButtons();
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const disabled = items.map((i) => !!i.disabled);
    let handled = true;
    if (e.key === 'Escape') closeMenu(true);
    else if (e.key === 'Tab') {
      closeMenu(false);
      handled = false;
    } else if (e.key === 'ArrowDown') focusItem(nextMenuIndex(current, 1, disabled));
    else if (e.key === 'ArrowUp') focusItem(nextMenuIndex(current, -1, disabled));
    else if (e.key === 'Home') focusItem(nextMenuIndex(-1, 1, disabled));
    else if (e.key === 'End') focusItem(nextMenuIndex(items.length, -1, disabled));
    else handled = false;
    if (handled) {
      // The viewer listens to Escape and the arrows on `window`: this key was the menu's.
      e.preventDefault();
      e.stopPropagation();
    }
  }

  $effect(() => {
    if (!open) return;
    // Outside press closes without stealing focus; scrolling or resizing would detach the
    // fixed menu from its trigger, so they close it too.
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (menuElement?.contains(target) || triggerElement?.contains(target)) return;
      closeMenu(false);
    };
    const onViewportChange = () => closeMenu(false);
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, true);
    };
  });
</script>

<button
  bind:this={triggerElement}
  type="button"
  class="overflow-trigger {variant} {triggerClass}"
  aria-haspopup="menu"
  aria-expanded={open}
  aria-controls={open ? menuId : undefined}
  aria-label={label}
  title={label}
  onclick={handleTriggerClick}
>
  <EllipsisVertical size={iconSize} />
  {#if showLabel}<span class="label">{label}</span>{/if}
</button>

{#if open}
  <div
    use:portal
    bind:this={menuElement}
    id={menuId}
    class="overflow-menu"
    role="menu"
    tabindex="-1"
    aria-label={label}
    style="top: {position.top}px; right: {position.right}px;"
    onkeydown={handleMenuKeydown}
  >
    {#each items as item (item.label)}
      <button
        type="button"
        role="menuitem"
        class="menu-item"
        class:danger={item.danger}
        disabled={item.disabled}
        tabindex="-1"
        onclick={(e) => select(item, e)}
      >
        {#if item.icon}
          <item.icon size={18} />
        {/if}
        <span>{item.label}</span>
      </button>
    {/each}
  </div>
{/if}

<style>
  /* `bar` gets nothing here: the host's global class (`.btn`) styles it whole. */
  .overflow-trigger.overlay,
  .overflow-trigger.toolbar {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    border: none;
    cursor: pointer;
  }
  .overflow-trigger.overlay {
    width: 36px;
    height: 36px;
    padding: 0;
    border-radius: var(--radius-sm);
    color: white;
    background: rgba(0, 0, 0, 0.6);
    transition: background-color 0.2s;
  }
  .overflow-trigger.overlay:hover,
  .overflow-trigger.overlay[aria-expanded='true'] {
    background: rgba(0, 0, 0, 0.85);
  }
  /* The viewer's top bar: a transparent round icon, like its neighbours (Google Photos). */
  .overflow-trigger.toolbar {
    width: 2.75rem;
    height: 2.75rem;
    padding: 0;
    border-radius: 50%;
    color: white;
    background: transparent;
    transition: background-color 0.15s;
  }
  .overflow-trigger.toolbar:hover,
  .overflow-trigger.toolbar[aria-expanded='true'] {
    background: rgba(255, 255, 255, 0.1);
  }

  .overflow-menu {
    position: fixed;
    z-index: 1200;
    min-width: 200px;
    padding: 0.375rem;
    display: flex;
    flex-direction: column;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow);
  }
  .menu-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    padding: 0.75rem 0.875rem;
    border: none;
    border-radius: var(--radius-xs);
    background: transparent;
    color: var(--text-primary);
    font: inherit;
    font-size: 0.9375rem;
    text-align: left;
    cursor: pointer;
  }
  .menu-item:hover:not(:disabled),
  .menu-item:focus-visible {
    background: color-mix(in srgb, var(--text-primary) 10%, transparent);
    outline: none;
  }
  .menu-item:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .menu-item.danger {
    color: var(--error);
  }
</style>
