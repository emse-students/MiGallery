<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { invalidate } from '$app/navigation';
  import {
    Check,
    X,
    CircleCheckBig,
    ArrowLeft,
    Maximize2,
    CircleHelp,
    Undo2,
  } from '@lucide/svelte';
  import FacePhotoDialog from '#lib/components/FacePhotoDialog.svelte';
  import BackgroundBlobs from '#lib/components/BackgroundBlobs.svelte';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import LoadingState from '#lib/components/LoadingState.svelte';
  import ErrorState from '#lib/components/ErrorState.svelte';
  import EmptyState from '#lib/components/EmptyState.svelte';
  import FaceCropThumb from '#lib/components/FaceCropThumb.svelte';
  import { toast } from '#lib/toast.ts';
  import { m } from '#lib/paraglide/messages.js';
  import { answerKey, type Suggestion } from '#lib/face-confirm-list.ts';
  import {
    canUndo,
    choose,
    clearLast,
    currentCard,
    isFinished,
    pendingSend,
    position,
    settleSend,
    startSession,
    undo,
    type Choice,
    type Held,
    type SendOutcome,
    type Session,
  } from '#lib/face-confirm-session.ts';

  /**
   * The faces given to the member WITH a doubt ("is it you?"), one card at a time, nearest first
   * (the server never sends a distance, the order is all the screen knows). The session logic,
   * including the held last answer behind "Annuler", is face-confirm-session.ts.
   */
  let session = $state<Session>(startSession([]));
  let loading = $state(true);
  let failed = $state(false);
  /** Answers on their way to the server: the end screen waits for them to settle. */
  let inFlight = $state(0);
  let stage: HTMLDivElement | undefined = $state();
  let doneHeading: HTMLHeadingElement | undefined = $state();
  /** Input is ignored from a choice until the next card has been drawn (no double answer). */
  let settling = $state(false);
  /** The face whose whole photo is open (null: none). */
  let opened = $state<Suggestion | null>(null);

  let card = $derived(currentCard(session));
  /** Over: no card left, nothing held, nothing on its way. */
  let done = $derived(isFinished(session) && !pendingSend(session) && inFlight === 0);

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
      session = startSession(body.suggestions ?? []);
      console.debug('[confirmer] faces listed', { count: session.total });
    } catch (e) {
      console.warn('[confirmer] the list could not be read', e);
      failed = true;
    } finally {
      loading = false;
    }
  }

  /** Send one answer through the one answer route (A5) and classify what came back. */
  async function sendAnswer(held: Held, keepalive = false): Promise<SendOutcome> {
    try {
      const res = await fetch('/api/users/me/face/matches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive,
        body: JSON.stringify({
          asset_id: held.item.asset_id,
          face_index: held.item.face_index,
          verdict: held.choice,
        }),
      });
      if (res.status === 404) {
        // Settled or given elsewhere meanwhile: skipped silently.
        console.debug('[confirmer] a face was already settled', answerKey(held.item));
        return { kind: 'gone' };
      }
      if (!res.ok) {
        console.warn('[confirmer] the answer was refused', res.status);
        return { kind: 'failed' };
      }
      const body = (await res.json().catch(() => ({}))) as {
        released?: Suggestion[];
        promoted?: Suggestion[];
      };
      return { kind: 'recorded', promoted: body.promoted ?? [], released: body.released ?? [] };
    } catch (e) {
      console.warn('[confirmer] the answer could not be sent', e);
      return { kind: 'failed' };
    }
  }

  /** Answers are sent one after the other: the engine's decisions depend on their order. */
  let chain: Promise<void> = Promise.resolve();

  /** Send a held answer and fold the server's reply in: a failure brings the card back. */
  function commit(held: Held) {
    inFlight += 1;
    chain = chain.then(async () => {
      const outcome = await sendAnswer(held);
      session = settleSend(session, held, outcome);
      if (outcome.kind === 'failed') toast.error(m.mpc_answer_error());
      else void invalidate('app:face-status');
      inFlight -= 1;
    });
  }

  /**
   * The member chose for the card they SAW (`seenKey`, carried from what was rendered or from the
   * whole-photo dialog): a card that is no longer the current one is not answered. Input is then
   * ignored until the next card has been drawn, so a double tap answers one face.
   */
  async function pick(choice: Choice, seenKey: string) {
    if (settling) return;
    const { session: next, send, accepted } = choose(session, choice, seenKey);
    if (!accepted) {
      console.debug('[confirmer] a choice for a card that is no longer current was refused');
      return;
    }
    settling = true;
    session = next;
    if (send) commit(send);
    await tick();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    settling = false;
    stage?.focus();
  }

  /** Bring the last card back; its answer was never sent. */
  async function takeBack() {
    if (!canUndo(session)) return;
    session = undo(session);
    await tick();
    stage?.focus();
  }

  // The end of the flow: the held answer is sent, the member can no longer undo it.
  $effect(() => {
    if (loading || !isFinished(session)) return;
    const held = pendingSend(session);
    if (!held) return;
    session = clearLast(session);
    commit(held);
  });

  // A card the engine settled (or a held answer's undo) changes the current card: a dialog opened
  // on another face is closed without answering.
  $effect(() => {
    if (opened && (!card || answerKey(card) !== answerKey(opened))) opened = null;
  });

  // The end screen takes the focus, so a keyboard or screen-reader user lands on it.
  $effect(() => {
    if (done && doneHeading) doneHeading.focus();
  });

  /**
   * The page is being left: the held answer goes out now, with `keepalive` so the browser lets the
   * request outlive the page. When an earlier answer is still in flight it is sent after it on the
   * same chain, so the order is kept (best effort: the page may be gone first). Its reply is not
   * read; what the engine settles shows at the next visit.
   */
  function flushOnLeave() {
    const held = pendingSend(session);
    if (!held) return;
    console.debug('[confirmer] leaving: sending the held answer', answerKey(held.item));
    session = clearLast(session);
    if (inFlight === 0) {
      void sendAnswer(held, true);
    } else {
      chain = chain.then(() => sendAnswer(held, true).then(() => undefined));
    }
  }

  /** The keys: O/Y/Enter yes, N/Delete/Backspace no, J not sure, U undo, Space/V whole photo. */
  function onStageKey(event: KeyboardEvent) {
    if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    const key = event.key.toLowerCase();
    const seen = card ? answerKey(card) : '';
    if (key === 'o' || key === 'y' || key === 'enter') {
      event.preventDefault();
      void pick('confirm', seen);
    } else if (key === 'n' || key === 'delete' || key === 'backspace') {
      event.preventDefault();
      void pick('reject', seen);
    } else if (key === 'j') {
      event.preventDefault();
      void pick('skip', seen);
    } else if (key === 'u') {
      event.preventDefault();
      if (!settling) void takeBack();
    } else if (key === ' ' || key === 'v') {
      event.preventDefault();
      opened = card;
    }
  }

  onMount(load);
  onDestroy(() => {
    if (typeof window !== 'undefined') flushOnLeave();
  });
</script>

<svelte:head>
  <title>{m.mpc_page_title()}</title>
</svelte:head>

<svelte:window onpagehide={flushOnLeave} />

<div class="confirm-main">
  <BackgroundBlobs />

  <PageHeader title={m.mpc_title()} subtitle={m.mpc_subtitle()} />

  <!-- A polite live region that exists from the start: the end screen is announced when it fills. -->
  <div class="confirm-live" aria-live="polite">
    {#if loading}
      <LoadingState label={m.mpc_loading()} />
    {:else if failed}
      <ErrorState title={m.mpc_load_error()} onRetry={load} />
    {:else if session.total === 0}
      <EmptyState
        icon={CircleCheckBig}
        title={m.mpc_empty_title()}
        description={m.mpc_empty_body()}
      >
        <a href="/mes-photos" class="btn primary">
          <ArrowLeft size={18} />
          {m.mpc_back()}
        </a>
      </EmptyState>
    {:else if done}
      <div class="confirm-done">
        <span class="confirm-done-icon"><CircleCheckBig size={40} aria-hidden="true" /></span>
        <h2 tabindex="-1" bind:this={doneHeading}>{m.mpc_done_title()}</h2>
        <ul>
          <li>{m.mpc_done_confirmed({ count: session.confirmed })}</li>
          <li>{m.mpc_done_rejected({ count: session.rejected })}</li>
          <li>{m.mpc_done_skipped({ count: session.skipped.length })}</li>
          {#if session.added + session.setAside + session.alreadySettled > 0}
            <li>
              {m.mpc_done_auto_title()}
              <ul class="confirm-done-auto">
                {#if session.added > 0}<li>{m.mpc_done_added({ count: session.added })}</li>{/if}
                {#if session.setAside > 0}<li>
                    {m.mpc_done_set_aside({ count: session.setAside })}
                  </li>{/if}
                {#if session.alreadySettled > 0}
                  <li>{m.mpc_done_settled({ count: session.alreadySettled })}</li>
                {/if}
              </ul>
            </li>
          {/if}
        </ul>
        <a href="/mes-photos" class="btn primary">
          <ArrowLeft size={18} />
          {m.mpc_back()}
        </a>
      </div>
    {:else if !card}
      <LoadingState label={m.mpc_saving()} />
    {:else}
      <div class="confirm-bar">
        <p class="confirm-count">
          {m.mpc_progress({ index: position(session), total: session.total })}
        </p>
        <button
          type="button"
          class="confirm-undo"
          disabled={!canUndo(session) || settling}
          title={m.mpc_undo_title()}
          onclick={takeBack}
        >
          <Undo2 size={16} aria-hidden="true" />
          <span>{m.mpc_undo()}</span>
        </button>
      </div>
      <!-- One card, a keyboard stop whose keys mirror its buttons (see onStageKey). -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
      <div
        class="confirm-stage"
        tabindex="0"
        role="group"
        aria-label={m.mpc_progress({ index: position(session), total: session.total })}
        bind:this={stage}
        onkeydown={onStageKey}
      >
        <div class="confirm-face">
          {#key answerKey(card)}
            <FaceCropThumb
              assetId={card.asset_id}
              faceIndex={card.face_index}
              alt={m.mpc_face_alt()}
            />
          {/key}
          <button
            type="button"
            class="confirm-open"
            tabindex="-1"
            aria-label={m.mpc_open_photo()}
            title={m.mpc_open_photo()}
            onclick={() => (opened = card)}
          >
            <Maximize2 size={18} aria-hidden="true" />
          </button>
        </div>
        <div class="confirm-actions">
          <button
            type="button"
            class="confirm-btn"
            tabindex="-1"
            disabled={settling}
            onclick={() => pick('reject', answerKey(card))}
          >
            <X size={18} aria-hidden="true" />
            <span>{m.mpc_not_me()}</span>
          </button>
          <button
            type="button"
            class="confirm-btn"
            tabindex="-1"
            disabled={settling}
            onclick={() => pick('skip', answerKey(card))}
          >
            <CircleHelp size={18} aria-hidden="true" />
            <span>{m.mpc_unsure()}</span>
          </button>
          <button
            type="button"
            class="confirm-btn yes"
            tabindex="-1"
            disabled={settling}
            onclick={() => pick('confirm', answerKey(card))}
          >
            <Check size={18} aria-hidden="true" />
            <span>{m.mpc_me()}</span>
          </button>
        </div>
      </div>
      <p class="confirm-hint confirm-keys">{m.mpc_keys_hint()}</p>
    {/if}
  </div>
</div>

<FacePhotoDialog
  item={opened}
  onClose={() => (opened = null)}
  onAnswer={(item, verdict) => {
    opened = null;
    void pick(verdict, answerKey(item));
  }}
/>

<style>
  .confirm-main {
    position: relative;
    min-height: 100vh;
    padding-bottom: 4rem;
  }

  .confirm-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    max-width: 24rem;
    margin: 0 auto 0.75rem;
  }

  .confirm-count {
    margin: 0;
    color: var(--text-primary);
    font-size: 0.9375rem;
    font-weight: 600;
  }

  .confirm-undo {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    min-height: 2.25rem;
    padding: 0.3rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-tertiary);
    color: var(--text-primary);
    font-size: 0.8125rem;
    font-weight: 600;
  }

  .confirm-undo:hover:not(:disabled) {
    border-color: var(--accent);
  }

  .confirm-undo:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .confirm-hint {
    margin: 0.75rem auto 0;
    max-width: 24rem;
    color: var(--text-secondary);
    font-size: 0.8125rem;
    text-align: center;
  }

  /* The keyboard hint is for a pointer that hovers; a phone answers by tapping. */
  @media (hover: none) {
    .confirm-keys {
      display: none;
    }
  }

  /* One card, the face large: the portrait is what the member recognises. */
  .confirm-stage {
    display: flex;
    flex-direction: column;
    max-width: 24rem;
    margin: 0 auto;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--bg-secondary);
  }

  .confirm-stage:focus-visible {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent);
  }

  .confirm-face {
    position: relative;
    aspect-ratio: 1;
  }

  /* Opens the whole photo. Small and in the corner: a stray tap on the face never opens it. */
  .confirm-open {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2.75rem;
    height: 2.75rem;
    border: none;
    border-radius: 999px;
    background: rgb(0 0 0 / 0.55);
    color: white;
  }

  .confirm-open:hover {
    background: rgb(0 0 0 / 0.75);
  }

  /* Three answers side by side; each label sits UNDER its icon and may wrap, never cut. */
  .confirm-actions {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 0.5rem;
    padding: 0.6rem;
  }

  .confirm-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.2rem;
    min-width: 0;
    min-height: 3.25rem;
    padding: 0.4rem 0.25rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-tertiary);
    color: var(--text-primary);
    font-size: 0.8125rem;
    font-weight: 600;
    line-height: 1.15;
    text-align: center;
    white-space: nowrap;
  }

  /* At 360 px three labels and three icons do not fit one line: the labels win. */
  @media (max-width: 26rem) {
    .confirm-btn {
      padding-inline: 0.15rem;
      font-size: 0.78rem;
    }

    .confirm-btn :global(svg) {
      display: none;
    }
  }

  .confirm-btn.yes {
    border-color: transparent;
    background: var(--accent);
    color: white;
  }

  .confirm-btn:hover {
    border-color: var(--accent);
  }

  .confirm-btn.yes:hover {
    background: var(--accent-hover);
  }

  .confirm-done {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    max-width: 24rem;
    margin: 2rem auto 0;
    text-align: center;
    color: var(--text-primary);
  }

  .confirm-done-icon {
    display: flex;
    color: var(--accent);
  }

  /* An icon in a button is its label's colour, at full strength (the empty state dims every svg). */
  .confirm-main :global(.btn svg) {
    color: currentColor;
    opacity: 1;
  }

  .confirm-done-auto {
    margin-top: 0.25rem;
  }

  .confirm-done h2 {
    font-size: 1.5rem;
    font-weight: 700;
  }

  .confirm-done ul {
    margin: 0;
    padding: 0;
    list-style: none;
    color: var(--text-secondary);
    font-size: 0.9375rem;
  }
</style>
