<script
  lang="ts"
  generics="T extends { id_user: string; name: string; formation: string | null; promo: number | null }"
>
  /**
   * A text field with a list of matching profiles under it - the sharing card's "who may see my
   * photos" search in Parametres.
   *
   * The list is portalled to `<body>` with fixed coordinates, like `OverflowMenu`: the card that
   * hosts the field clips its children (`overflow: hidden`, which rounds its rows), and the list
   * used to be cut at the card's bottom edge with a scrollbar inside it. It opens below the
   * field, or above it near the bottom of the viewport (`placePopover`), and follows the field
   * on scroll and resize.
   *
   * Accessibility is the WAI-ARIA combobox pattern: the input is the `combobox`, the list a
   * `listbox`, the arrows move the active option (`aria-activedescendant`, focus stays in the
   * input), Enter picks it, Escape and Tab close. Clicking outside closes through the input's
   * own blur; a press on the list does not blur the input (its `mousedown` is cancelled), so
   * picking an option never races a close.
   */
  import { tick } from 'svelte';
  import Spinner from './Spinner.svelte';
  import { portal } from '$lib/portal';
  import { placePopover } from '$lib/popover-position';
  import { nextMenuIndex } from '$lib/overflow-menu';
  import { m } from '$lib/paraglide/messages';

  interface Props {
    /** The profiles matching `query`, best first. */
    options: T[];
    query: string;
    placeholder: string;
    disabled?: boolean;
    /** Still fetching the roster: the list shows a spinner instead of options. */
    loading?: boolean;
    /** Options are shown but cannot be picked (an authorisation is being saved). */
    optionsDisabled?: boolean;
    onPick: (option: T) => void;
    /** Typing; the page drops any previously picked profile. */
    onType?: () => void;
    onOpen?: () => void;
  }

  let {
    options,
    query = $bindable(),
    placeholder,
    disabled = false,
    loading = false,
    optionsDisabled = false,
    onPick,
    onType,
    onOpen,
  }: Props = $props();

  /** The list's own cap; below it the viewport decides (`placePopover`). */
  const LIST_MAX_HEIGHT = 300;
  const listId = `profile-picker-${Math.random().toString(36).slice(2, 10)}`;

  let open = $state(false);
  let active = $state(-1);
  let inputElement = $state<HTMLInputElement | null>(null);
  let listElement = $state<HTMLDivElement | null>(null);
  let box = $state({ top: 0, left: 0, width: 0, maxHeight: LIST_MAX_HEIGHT });

  let shown = $derived(open && (loading || options.length > 0));

  function place() {
    if (!inputElement) return;
    const rect = inputElement.getBoundingClientRect();
    const natural = Math.min(LIST_MAX_HEIGHT, listElement?.scrollHeight ?? LIST_MAX_HEIGHT);
    const p = placePopover(rect, natural, window.innerHeight);
    box = {
      top: p.top,
      left: rect.left,
      width: rect.width,
      maxHeight: Math.min(LIST_MAX_HEIGHT, p.maxHeight),
    };
  }

  async function show() {
    open = true;
    onOpen?.();
    place();
    await tick();
    place();
  }

  function close() {
    open = false;
    active = -1;
  }

  function pick(option: T) {
    if (optionsDisabled) return;
    console.debug(`[ProfilePicker] picked ${option.id_user}`);
    onPick(option);
    close();
  }

  async function moveActive(delta: 1 | -1) {
    if (!shown) await show();
    active = nextMenuIndex(
      active < 0 && delta === -1 ? options.length : active,
      delta,
      options.map(() => optionsDisabled)
    );
    await tick();
    listElement?.querySelector(`#${listId}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      void moveActive(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Enter' && shown && active >= 0 && options[active]) {
      e.preventDefault();
      pick(options[active]);
    } else if (e.key === 'Escape' && shown) {
      e.preventDefault();
      close();
    } else if (e.key === 'Tab') {
      close();
    }
  }

  // The list is fixed: it follows the field when the page scrolls or resizes, and re-measures
  // when the options change (a narrower query is a shorter list). Its own scroll is ignored.
  $effect(() => {
    if (!shown) return;
    void options.length;
    void tick().then(place);
    const onScroll = (e: Event) => {
      if (listElement && e.target instanceof Node && listElement.contains(e.target)) return;
      place();
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', place);
    };
  });
</script>

<input
  bind:this={inputElement}
  bind:value={query}
  type="text"
  role="combobox"
  aria-autocomplete="list"
  aria-expanded={shown}
  aria-controls={shown ? listId : undefined}
  aria-activedescendant={shown && active >= 0 ? `${listId}-${active}` : undefined}
  autocomplete="off"
  {placeholder}
  aria-label={placeholder}
  class="settings-input selector-input"
  {disabled}
  oninput={() => {
    active = -1;
    onType?.();
    void show();
  }}
  onfocus={() => void show()}
  onblur={close}
  onkeydown={handleKeydown}
/>

{#if shown}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    use:portal
    bind:this={listElement}
    id={listId}
    class="profile-list"
    role="listbox"
    tabindex="-1"
    aria-label={placeholder}
    style="top: {box.top}px; left: {box.left}px; width: {box.width}px; max-height: {box.maxHeight}px;"
    onmousedown={(e) => e.preventDefault()}
  >
    {#if loading}
      <div class="list-loading"><Spinner size={16} /> {m.common_loading()}</div>
    {:else}
      {#each options as option, i (option.id_user)}
        <button
          type="button"
          id="{listId}-{i}"
          role="option"
          aria-selected={i === active}
          tabindex="-1"
          class="profile-option"
          class:active={i === active}
          disabled={optionsDisabled}
          onclick={() => pick(option)}
          onpointermove={() => (active = i)}
        >
          <span class="option-name">{option.name}</span>
          {#if option.formation || option.promo}
            <span class="option-meta">
              {#if option.promo}{option.promo}{/if}
              {#if option.formation}
                {#if option.promo}•{/if}
                {option.formation}
              {/if}
            </span>
          {/if}
        </button>
      {/each}
    {/if}
  </div>
{/if}

<style>
  /* Portalled under <body>: styled here, not by the page. Above the bars (1000), under dialogs. */
  .profile-list {
    position: fixed;
    z-index: 1200;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 0.25rem 0;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-xs);
    box-shadow: var(--shadow);
  }

  .list-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 1rem;
    color: var(--text-secondary);
  }

  /* Stated in full: app.css fills every bare button (`button:not(.topbar button)`). */
  .profile-option {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: flex-start;
    gap: 0.25rem;
    width: 100%;
    padding: 0.75rem 1rem;
    border: none;
    border-radius: 0;
    background: none;
    color: var(--text-primary);
    font-size: 0.95rem;
    line-height: 1.3;
    text-align: left;
    cursor: pointer;
  }

  .profile-option.active:not(:disabled) {
    background: var(--bg-tertiary);
  }

  .profile-option:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .option-name {
    font-weight: 500;
  }

  .option-meta {
    font-size: 0.85rem;
    color: var(--text-secondary);
  }
</style>
