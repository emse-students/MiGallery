<script lang="ts">
  /**
   * `/auth/handoff` - where Canari lands a signed-in user with a one-time token in the FRAGMENT
   * (docs/wiki/authentication.md, "Signed in from Canari"). The token leaves the address bar
   * before anything else runs, is posted to `/api/auth/handoff`, and the page acts on the answer.
   * The interstitial is ALWAYS shown before a session opens: it names who the user is about to be.
   * The logic is the vendored `handoff-landing.ts`; this page draws it and builds the login URL.
   */
  import { onMount } from 'svelte';
  import { replaceState } from '$app/navigation';
  import {
    redeemHandoff,
    takeHandoffToken,
    type HandoffInterstitial,
    type LandingStep,
  } from '#lib/handoff/handoff-landing.ts';
  import { loginUrlWithRedirect } from '#lib/auth-redirect.ts';
  import { m } from '#lib/paraglide/messages.js';

  let interstitial = $state<HandoffInterstitial | null>(null);
  let working = $state(true);
  /** Held in this page's memory only, for the click; never written anywhere. */
  let token = '';

  function act(step: LandingStep): void {
    if (step.kind === 'go') {
      location.replace(step.to);
    } else if (step.kind === 'login') {
      location.replace(loginUrlWithRedirect(step.redirectTo));
    } else {
      interstitial = step.interstitial;
      working = false;
    }
  }

  onMount(() => {
    token = takeHandoffToken(location, {
      replaceState: (_data, _unused, url) => replaceState(String(url ?? location.pathname), {}),
    });
    void redeemHandoff(token, false).then(act);
  });

  async function proceed(): Promise<void> {
    working = true;
    act(await redeemHandoff(token, true));
  }

  function cancel(): void {
    token = '';
    location.replace('/');
  }
</script>

<svelte:head>
  <title>{m.handoff_title()}</title>
</svelte:head>

<main class="handoff">
  {#if interstitial}
    <section class="card">
      {#if interstitial.next.photo}
        <img
          class="avatar"
          src={interstitial.next.photo}
          alt=""
          width="96"
          height="96"
          onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')}
        />
      {/if}
      <p class="who">
        {interstitial.current
          ? m.handoff_switch({ current: interstitial.current, next: interstitial.next.name })
          : m.handoff_as_next({ next: interstitial.next.name })}
      </p>
      <div class="actions">
        <button class="secondary" type="button" onclick={cancel} disabled={working}>
          {m.handoff_cancel()}
        </button>
        <button class="primary" type="button" onclick={proceed} disabled={working}>
          {m.handoff_continue()}
        </button>
      </div>
    </section>
  {:else}
    <p class="working">{m.handoff_working()}</p>
  {/if}
</main>

<style>
  .handoff {
    display: grid;
    place-items: center;
    min-height: 60vh;
    padding: var(--container-padding);
  }
  .card {
    display: grid;
    gap: 16px;
    justify-items: center;
    max-width: 420px;
    padding: 24px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-secondary);
    text-align: center;
  }
  .avatar {
    border-radius: 50%;
    object-fit: cover;
  }
  .who {
    color: var(--text-primary);
  }
  .working {
    color: var(--text-secondary);
  }
  .actions {
    display: flex;
    gap: 12px;
  }
  .actions button {
    padding: 10px 18px;
    border-radius: var(--radius-xs);
    border: 1px solid var(--border);
    cursor: pointer;
  }
  .primary {
    background: var(--accent);
    color: var(--bg-primary);
    border-color: var(--accent);
  }
  .secondary {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }
</style>
