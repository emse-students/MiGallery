<script lang="ts">
  import { UserCog } from '@lucide/svelte';
  import AdminPage from '#lib/components/AdminPage.svelte';
  import { m } from '#lib/paraglide/messages.js';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  let busy = $state(false);
  let failed = $state(false);

  /**
   * Start the impersonation: a POST, so it passes the Origin check and the step-up like every
   * other change (a handoff session is sent through MiConnect by the fetch wrapper and lands back
   * here). A full navigation afterwards, so every layout reloads as the new effective user.
   */
  async function confirm() {
    busy = true;
    failed = false;
    try {
      const res = await fetch('/api/change-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: data.target.id }),
      });
      if (!res.ok) {
        console.warn('[login-as] refused', res.status);
        failed = true;
        return;
      }
      window.location.href = '/';
    } catch (e: unknown) {
      console.warn('[login-as] request failed', e);
      failed = true;
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head>
  <title>{m.login_as_page_title()}</title>
</svelte:head>

<AdminPage title={m.login_as_title()} icon={UserCog} maxWidth="640px">
  <div class="card">
    <p>{m.login_as_confirm_text({ name: data.target.name, id: data.target.id })}</p>
    {#if failed}
      <p class="login-as-error" role="alert">{m.login_as_error()}</p>
    {/if}
    <div class="login-as-actions">
      <a href="/admin/users" class="btn">{m.login_as_cancel()}</a>
      <button type="button" class="btn primary" disabled={busy} onclick={confirm}>
        {m.login_as_confirm()}
      </button>
    </div>
  </div>
</AdminPage>

<style>
  .login-as-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
    margin-top: 1.25rem;
  }

  .login-as-error {
    margin-top: 0.75rem;
    color: var(--error);
  }
</style>
