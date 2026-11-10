<!--
  FaceMatchingWait.svelte - "Mes photos" right after a selfie (owner, 2026-11-10).

  The server looks for the member's photos in the background. This panel keeps them company until
  the server says that run is over (`matching: false` from GET /api/users/me/face/enrolment), then
  says what it found: faces to check (a button to the confirmation flow), photos shown below, or
  nothing yet. The END of the wait is the server's answer, never a clock: the interval only paces
  how often the display asks again, and a failed read is retried, never taken for "done".
-->
<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { ChevronRight, ScanFace, Search } from '@lucide/svelte';
  import { m } from '#lib/paraglide/messages.js';
  import {
    isEnrolmentStatus,
    waitOutcome,
    type EnrolmentStatus,
    type WaitOutcome,
  } from '#lib/face-matching-wait.ts';

  interface Props {
    /** Called once, when the server reports the run over, with what it found. */
    onDone: (status: EnrolmentStatus, outcome: WaitOutcome) => void;
  }

  let { onDone }: Props = $props();

  /** How often the display asks again while the server says "still matching". */
  const POLL_MS = 2000;

  let status = $state<EnrolmentStatus | null>(null);
  let readFailed = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  let outcome = $derived<WaitOutcome>(status ? waitOutcome(status) : 'waiting');

  async function poll() {
    if (stopped) return;
    try {
      const res = await fetch('/api/users/me/face/enrolment');
      const body: unknown = await res.json();
      if (!res.ok || !isEnrolmentStatus(body)) {
        throw new Error(`unusable status answer (${res.status})`);
      }
      readFailed = false;
      status = body;
      const result = waitOutcome(body);
      console.debug('[face-wait] status', result, body);
      if (result !== 'waiting') {
        stopped = true;
        onDone(body, result);
        return;
      }
    } catch (e) {
      console.warn('[face-wait] status read failed, asking again', e);
      readFailed = true;
    }
    if (!stopped) timer = setTimeout(poll, POLL_MS);
  }

  onMount(() => {
    console.debug('[face-wait] waiting for the server re-match to end');
    void poll();
  });

  onDestroy(() => {
    stopped = true;
    if (timer) clearTimeout(timer);
  });
</script>

<section class="face-wait" aria-live="polite">
  {#if outcome === 'waiting'}
    <span class="wait-icon spin"><Search size={28} aria-hidden="true" /></span>
    <h2>{m.mpw_title()}</h2>
    <p>{readFailed ? m.mpw_status_error() : m.mpw_hint()}</p>
  {:else if outcome === 'to_check' && status}
    <span class="wait-icon"><ScanFace size={28} aria-hidden="true" /></span>
    <h2>{m.mpw_found({ count: status.photos })}</h2>
    <p>{m.mpw_to_check({ count: status.toConfirm })}</p>
    <a href="/mes-photos/confirmer" class="wait-cta">
      <span>{m.mpw_check_cta()}</span>
      <ChevronRight size={18} aria-hidden="true" />
    </a>
  {:else if outcome === 'found' && status}
    <span class="wait-icon"><ScanFace size={28} aria-hidden="true" /></span>
    <h2>{m.mpw_found({ count: status.photos })}</h2>
    <p>{m.mpw_show()}</p>
  {:else}
    <span class="wait-icon"><Search size={28} aria-hidden="true" /></span>
    <h2>{m.mpw_none_title()}</h2>
    <p>{m.mpw_none_body()}</p>
  {/if}
</section>

<style>
  .face-wait {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    margin: 0 0 1rem;
    padding: 1.5rem 1rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--bg-secondary);
    color: var(--text-primary);
    text-align: center;
  }

  .face-wait h2 {
    font-size: 1.125rem;
    font-weight: 700;
  }

  .face-wait p {
    max-width: 26rem;
    color: var(--text-secondary);
    font-size: 0.875rem;
  }

  .wait-icon {
    display: flex;
    color: var(--accent);
  }

  .spin {
    animation: face-wait-pulse 1.4s ease-in-out infinite;
  }

  @keyframes face-wait-pulse {
    50% {
      opacity: 0.35;
    }
  }

  .wait-cta {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    margin-top: 0.5rem;
    padding: 0.6rem 1.1rem;
    border-radius: var(--radius-sm);
    background: var(--accent);
    color: white;
    font-weight: 600;
    text-decoration: none;
  }

  @media (prefers-reduced-motion: reduce) {
    .spin {
      animation: none;
    }
  }
</style>
