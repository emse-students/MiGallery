<script lang="ts">
  import { onMount } from 'svelte';
  import { Check, X, CircleCheckBig, ArrowLeft } from '@lucide/svelte';
  import BackgroundBlobs from '#lib/components/BackgroundBlobs.svelte';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import LoadingState from '#lib/components/LoadingState.svelte';
  import ErrorState from '#lib/components/ErrorState.svelte';
  import EmptyState from '#lib/components/EmptyState.svelte';
  import FaceCropThumb from '#lib/components/FaceCropThumb.svelte';
  import { toast } from '#lib/toast.ts';
  import { m } from '#lib/paraglide/messages.js';

  /** One face given to the member with a doubt: the photo and which face in it. */
  interface Suggestion {
    asset_id: string;
    face_index: number;
  }

  let suggestions = $state<Suggestion[]>([]);
  let loading = $state(true);
  let failed = $state(false);
  /** The faces whose answer is on its way, so a double tap answers once. */
  let answering = $state<string[]>([]);

  const keyOf = (s: Suggestion) => `${s.asset_id}:${s.face_index}`;

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
      console.debug('[confirmer] faces to confirm', suggestions.length);
    } catch (e) {
      console.warn('[confirmer] the list could not be read', e);
      failed = true;
    } finally {
      loading = false;
    }
  }

  /** The member's answer, through the one answer route (A5); the face leaves the list once taken. */
  async function answer(item: Suggestion, verdict: 'confirm' | 'reject') {
    const key = keyOf(item);
    if (answering.includes(key)) return;
    answering = [...answering, key];
    try {
      const res = await fetch('/api/users/me/face/matches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asset_id: item.asset_id,
          face_index: item.face_index,
          verdict,
        }),
      });
      // 404: the face was answered or given to someone else meanwhile - it leaves the list too.
      if (!res.ok && res.status !== 404) {
        console.warn('[confirmer] the answer was refused', res.status);
        toast.error(m.mpc_answer_error());
        return;
      }
      suggestions = suggestions.filter((s) => keyOf(s) !== key);
    } catch (e) {
      console.warn('[confirmer] the answer could not be sent', e);
      toast.error(m.mpc_answer_error());
    } finally {
      answering = answering.filter((k) => k !== key);
    }
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
    <p class="confirm-count">{m.mpc_count({ count: suggestions.length })}</p>
    <ul class="confirm-grid">
      {#each suggestions as item (keyOf(item))}
        <li class="confirm-card">
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
              class="btn"
              disabled={answering.includes(keyOf(item))}
              onclick={() => answer(item, 'reject')}
            >
              <X size={18} />
              {m.mpc_not_me()}
            </button>
            <button
              type="button"
              class="btn primary"
              disabled={answering.includes(keyOf(item))}
              onclick={() => answer(item, 'confirm')}
            >
              <Check size={18} />
              {m.mpc_me()}
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

  .confirm-count {
    margin: 0 0 1rem;
    color: var(--text-secondary);
    font-size: 0.875rem;
  }

  /* Flat cards: the face, then the two answers under it. */
  .confirm-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));
    gap: 0.75rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .confirm-card {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--bg-secondary);
  }

  .confirm-face {
    position: relative;
    aspect-ratio: 1;
  }

  .confirm-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
    padding: 0.5rem;
  }

  .confirm-actions .btn {
    padding: 0.6rem 0.5rem;
    font-size: 0.8125rem;
  }
</style>
