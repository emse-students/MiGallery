<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { Check, X, CircleCheckBig, ArrowLeft } from '@lucide/svelte';
  import BackgroundBlobs from '#lib/components/BackgroundBlobs.svelte';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import LoadingState from '#lib/components/LoadingState.svelte';
  import ErrorState from '#lib/components/ErrorState.svelte';
  import EmptyState from '#lib/components/EmptyState.svelte';
  import FaceCropThumb from '#lib/components/FaceCropThumb.svelte';
  import { toast } from '#lib/toast.ts';
  import { m } from '#lib/paraglide/messages.js';
  import {
    answerKey,
    removeKeys,
    restoreAt,
    type Suggestion,
    type Verdict,
  } from '#lib/face-confirm-list.ts';

  /**
   * The faces given to the member WITH a doubt ("is it you?"), in the server's order: NEAREST FIRST
   * (faces v2). The server never sends a distance, the order is all the screen knows. A photo shown
   * without a question is refused from "Mes photos" itself ("Ce n'est pas moi" on each photo).
   */
  let suggestions = $state<Suggestion[]>([]);
  let loading = $state(true);
  let failed = $state(false);
  /** The faces whose answer is on its way, so a double tap answers once. */
  let answering = $state<string[]>([]);
  let grid: HTMLUListElement | undefined = $state();

  async function load() {
    loading = true;
    failed = false;
    try {
      const res = await fetch('/api/users/me/face/matches');
      if (!res.ok) {
        console.warn('[confirmer] the list was refused', res.status);
        failed = true;
        return;
      }
      const body = (await res.json()) as { suggestions?: Suggestion[] };
      suggestions = body.suggestions ?? [];
      console.debug('[confirmer] faces listed', { count: suggestions.length });
    } catch (e) {
      console.warn('[confirmer] the list could not be read', e);
      failed = true;
    } finally {
      loading = false;
    }
  }

  /**
   * Send one answer through the one answer route (A5). The tile leaves the list AT ONCE; a refusal
   * puts it back where it was. 404 means the face was answered or given to someone else
   * meanwhile: it stays gone. A rejection may release other faces (the new negative example
   * withholds them from the member): they leave the list too, as do the faces a confirmation
   * makes theirs without a question (`promoted`, in "Mes photos" now). Returns whether it was
   * recorded.
   */
  async function answer(item: Suggestion, verdict: Verdict): Promise<boolean> {
    const key = answerKey(item);
    if (answering.includes(key)) return false;
    const index = suggestions.findIndex((s) => answerKey(s) === key);
    if (index < 0) return false;
    answering = [...answering, key];
    suggestions = removeKeys(suggestions, [key]);
    try {
      const res = await fetch('/api/users/me/face/matches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asset_id: item.asset_id, face_index: item.face_index, verdict }),
      });
      if (!res.ok && res.status !== 404) {
        console.warn('[confirmer] the answer was refused', res.status);
        suggestions = restoreAt(suggestions, item, index);
        toast.error(m.mpc_answer_error());
        return false;
      }
      if (res.ok) {
        const body = (await res.json()) as { released?: Suggestion[]; promoted?: Suggestion[] };
        const released = (body.released ?? []).map(answerKey);
        const promoted = (body.promoted ?? []).map(answerKey);
        if (released.length > 0 || promoted.length > 0) {
          suggestions = removeKeys(suggestions, [...released, ...promoted]);
        }
        if (promoted.length > 0) {
          toast.info(m.mpc_promoted({ count: promoted.length }));
        }
        if (released.length > 0) {
          toast.info(m.mpc_released({ count: released.length }));
        }
      }
      return true;
    } catch (e) {
      console.warn('[confirmer] the answer could not be sent', e);
      suggestions = restoreAt(suggestions, item, index);
      toast.error(m.mpc_answer_error());
      return false;
    } finally {
      answering = answering.filter((k) => k !== key);
    }
  }

  /** Answer the card at `index` from the keyboard or a button, then focus the one that follows. */
  async function answerAt(index: number, verdict: Verdict) {
    const item = suggestions[index];
    if (!item) return;
    const sent = answer(item, verdict);
    await tick();
    focusCard(Math.min(index, suggestions.length - 1));
    await sent;
  }

  function focusCard(index: number) {
    if (index < 0) return;
    grid?.querySelectorAll<HTMLElement>('.confirm-card')[index]?.focus();
  }

  /** The keys a focused card answers to: O/Y/Enter yes, N/Delete/Backspace no, arrows move. */
  function onCardKey(event: KeyboardEvent, index: number) {
    if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    const key = event.key.toLowerCase();
    if (key === 'o' || key === 'y' || key === 'enter') {
      event.preventDefault();
      void answerAt(index, 'confirm');
    } else if (key === 'n' || key === 'delete' || key === 'backspace') {
      event.preventDefault();
      void answerAt(index, 'reject');
    } else if (
      key === 'arrowright' ||
      key === 'arrowdown' ||
      key === 'arrowleft' ||
      key === 'arrowup'
    ) {
      event.preventDefault();
      const columns = gridColumns();
      const step =
        key === 'arrowright'
          ? 1
          : key === 'arrowleft'
            ? -1
            : key === 'arrowdown'
              ? columns
              : -columns;
      focusCard(Math.max(0, Math.min(suggestions.length - 1, index + step)));
    }
  }

  /** How many cards a row of the grid holds now (arrow up/down moves by a row). */
  function gridColumns(): number {
    if (!grid) return 1;
    const template = getComputedStyle(grid).gridTemplateColumns;
    return Math.max(1, template.split(' ').filter(Boolean).length);
  }

  onMount(load);
</script>

<svelte:head>
  <title>{m.mpc_page_title()}</title>
</svelte:head>

<div class="confirm-main">
  <BackgroundBlobs />

  <PageHeader title={m.mpc_title()} subtitle={m.mpc_subtitle()} />

  {#if loading}
    <LoadingState label={m.mpc_loading()} />
  {:else if failed}
    <ErrorState title={m.mpc_load_error()} onRetry={load} />
  {:else if suggestions.length === 0}
    <EmptyState icon={CircleCheckBig} title={m.mpc_empty_title()} description={m.mpc_empty_body()}>
      <a href="/mes-photos" class="btn primary">
        <ArrowLeft size={18} />
        {m.mpc_back()}
      </a>
    </EmptyState>
  {:else}
    <div class="confirm-bar" aria-live="polite">
      <p class="confirm-count">
        {m.mpc_count({ count: suggestions.length })}
      </p>
      <p class="confirm-hint">{m.mpc_order_hint()}</p>
      <p class="confirm-hint confirm-keys">{m.mpc_keys_hint()}</p>
    </div>
    <ul class="confirm-grid" bind:this={grid}>
      {#each suggestions as item, index (answerKey(item))}
        <!-- The card is a keyboard stop whose keys mirror its own two buttons (which leave the tab
             order, so a keyboard user tabs card to card); a pointer uses the buttons. -->
        <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
        <li
          class="confirm-card"
          tabindex="0"
          aria-label={m.mpc_card_label({ index: index + 1, total: suggestions.length })}
          onkeydown={(e) => onCardKey(e, index)}
        >
          <div class="confirm-face">
            <FaceCropThumb
              assetId={item.asset_id}
              faceIndex={item.face_index}
              alt={m.mpc_face_alt()}
            />
          </div>
          <div class="confirm-actions">
            <button
              type="button"
              class="confirm-btn"
              tabindex="-1"
              disabled={answering.includes(answerKey(item))}
              onclick={() => answerAt(index, 'reject')}
            >
              <X size={18} aria-hidden="true" />
              <span>{m.mpc_not_me()}</span>
            </button>
            <button
              type="button"
              class="confirm-btn yes"
              tabindex="-1"
              disabled={answering.includes(answerKey(item))}
              onclick={() => answerAt(index, 'confirm')}
            >
              <Check size={18} aria-hidden="true" />
              <span>{m.mpc_me()}</span>
            </button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .confirm-main {
    position: relative;
    min-height: 100vh;
    padding-bottom: 4rem;
  }

  /* The count and how the list is ordered, kept in view while scrolling a long list. */
  .confirm-bar {
    position: sticky;
    top: 0;
    z-index: 2;
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.25rem 1rem;
    margin: 0 0 1rem;
    padding: 0.6rem 0;
    background: var(--bg-primary);
  }

  .confirm-count {
    margin: 0;
    color: var(--text-primary);
    font-size: 0.9375rem;
    font-weight: 600;
  }

  .confirm-hint {
    margin: 0;
    color: var(--text-secondary);
    font-size: 0.8125rem;
  }

  /* The keyboard hint is for a pointer that hovers; a phone answers by tapping. */
  @media (hover: none) {
    .confirm-keys {
      display: none;
    }
  }

  .confirm-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr));
    gap: 0.75rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .confirm-card {
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--bg-secondary);
    transition:
      border-color 0.15s var(--ease),
      box-shadow 0.15s var(--ease);
  }

  .confirm-card:focus-visible {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent);
  }

  .confirm-face {
    position: relative;
    aspect-ratio: 1;
  }

  /* Two answers side by side. The label sits UNDER its icon and may wrap, so neither is ever
     cut ("C'est m..." was the global .btn's nowrap in a 10rem card). */
  .confirm-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.4rem;
    padding: 0.45rem;
  }

  .confirm-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.2rem;
    min-width: 0;
    min-height: 2.75rem;
    padding: 0.4rem 0.25rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-tertiary);
    color: var(--text-primary);
    font-size: 0.8125rem;
    font-weight: 600;
    line-height: 1.15;
    text-align: center;
    white-space: normal;
    overflow-wrap: anywhere;
  }

  .confirm-btn.yes {
    border-color: transparent;
    background: var(--accent);
    color: white;
  }

  .confirm-btn:hover:not(:disabled) {
    border-color: var(--accent);
  }

  .confirm-btn.yes:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .confirm-btn:disabled {
    opacity: 0.55;
    cursor: default;
  }

  @media (min-width: 40rem) {
    .confirm-actions {
      gap: 0.5rem;
      padding: 0.55rem;
    }
  }
</style>
