<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { activeOperations } from '#lib/operations.ts';
  import { navigationModalStore } from '#lib/navigation-store.ts';
  import { theme } from '#lib/theme.ts';
  import type { User } from '#lib/types/api.ts';
  import ToastContainer from '#lib/components/ToastContainer.svelte';
  import Modal from '#lib/components/Modal.svelte';
  import ConfirmHost from '#lib/components/ConfirmHost.svelte';
  import MobileNav from '#lib/components/MobileNav.svelte';
  import SideNav from '#lib/components/SideNav.svelte';
  import ThemeToggle from '#lib/components/ThemeToggle.svelte';
  import LocaleToggle from '#lib/components/LocaleToggle.svelte';
  import Seo from '#lib/components/Seo.svelte';
  import { siteSeo, type SeoMeta } from '#lib/seo.ts';
  import { m } from '#lib/paraglide/messages.js';
  import { loginUrlWithRedirect, REDIRECT_PARAM } from '#lib/auth-redirect.ts';
  import { toast } from '#lib/toast.ts';
  import '../app.css';

  let u = $derived(page.data?.session?.user as User);

  // One head for the whole app. A page contributes its card by returning `seo` from its `load`
  // (only the album page does - it is the only URL anybody shares); everything else falls back to
  // the gallery's own. Emitting it here rather than per page is what keeps a single og:title in
  // the document: two of any of these tags is an unfurler picking one at random.
  let seo = $derived((page.data as { seo?: SeoMeta }).seo ?? siteSeo());
  let isAuthenticated = $derived(!!u);
  let impersonating = $derived(page.data?.session?.impersonating === true);
  let isHomePage = $derived(page.url.pathname === '/');
  /**
   * An album page draws its own full-bleed cover hero on a phone, with floating back and menu
   * buttons, so the site bar steps aside there (<= 768 px only; ui-redesign D10).
   */
  let isAlbumPage = $derived(/^\/albums\/[^/]+\/?$/.test(page.url.pathname));

  let { children } = $props();

  onMount(() => {
    theme.initialize();
  });

  let navigationModal = $derived($navigationModalStore);
  let showNavigationWarning = $derived.by(() => navigationModal?.show ?? false);

  function confirmNavigation() {
    if (navigationModal?.href) {
      activeOperations.clear();
      const href = navigationModal.href;
      navigationModalStore.set(null);
      window.location.href = href;
    }
  }

  function cancelNavigation() {
    navigationModalStore.set(null);
  }

  /**
   * End an impersonation: the same POST /api/change-user that started it, with `userId: null`,
   * judged on the session's REAL account. A full navigation afterwards, so every layout reloads as
   * the admin. There is no GET for this: a link must never change the session.
   */
  async function stopImpersonating() {
    try {
      const res = await fetch('/api/change-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: null }),
      });
      if (!res.ok) {
        console.warn('[impersonation] stop refused', res.status);
        toast.error(m.impersonation_stop_error());
        return;
      }
      window.location.href = '/admin';
    } catch (e: unknown) {
      console.warn('[impersonation] stop failed', e);
      toast.error(m.impersonation_stop_error());
    }
  }

  async function handleSignOut() {
    // Logout deletes the session row, and an impersonation is a column of that row: nothing to
    // stop first (a separate stop call would be a change a handoff session is refused).
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
      });
    } catch (e: unknown) {
      console.warn('Failed to call /api/auth/logout:', e);
    }

    window.location.href = '/';
  }

  function handleSignIn() {
    // Signing in from the navbar means "carry on where I am", except on the
    // home page, which may already carry a destination of its own.
    const target = isHomePage
      ? page.url.searchParams.get(REDIRECT_PARAM)
      : page.url.pathname + page.url.search;
    window.location.href = loginUrlWithRedirect(target);
  }
</script>

<!--
	The `<title>` element stays with the pages, and every route sets one. This layout also carried
	`<title>MiGallery</title>`, which never reached a single page: Svelte deduplicates `<title>` in
	`<svelte:head>` and the page's wins, so the layout read as the source of a title it never
	supplied. Verified on prod - `/` served exactly one, `MiGallery - Accueil`.
-->
<Seo meta={seo} />

<nav class="topbar" class:album-page={isAlbumPage}>
  <div class="brand">
    <img
      src="/logo.webp"
      alt="MiGallery"
      class="logo"
      width="256"
      height="256"
      fetchpriority="high"
    />
    <a href="/">MiGallery</a>
  </div>

  <div class="user">
    {#if u}
      <a href="/mes-photos" class="avatar-link">
        <div class="avatar" title={u.name || `${u.first_name || ''} ${u.last_name || ''}`.trim()}>
          {#if u.photos_asset_id}
            <img
              src={`/api/users/${encodeURIComponent(u.id_user)}/avatar${u.photos_asset_id ? `?v=${encodeURIComponent(u.photos_asset_id)}` : ''}`}
              alt="avatar"
              onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')}
            />
          {:else}
            <span class="initials"
              >{(u.first_name || 'U').charAt(0)}{(u.last_name || '').charAt(0) || 'U'}</span
            >
          {/if}
        </div>
      </a>
      <span class="user-name">{u.name}</span>
      <button type="button" class="btn-logout" onclick={() => handleSignOut()}
        >{m.nav_logout()}</button
      >
    {:else}
      <!--
				Theme and language sit here only while signed out. Once there is an account they live in
				/parametres, which is the account's own page and already carries them: drawing them in
				both places would be the same preference offered twice, in a bar that is already full.
			-->
      <div class="nav-toggles">
        <ThemeToggle />
        <LocaleToggle />
      </div>
      <!-- The home page's own card carries the one sign-in button (ui-redesign #23). -->
      {#if !isHomePage}
        <button type="button" class="btn-login" onclick={() => handleSignIn()}
          >{m.nav_login()}</button
        >
      {/if}
    {/if}
  </div>
</nav>

<SideNav />

<!-- The shell steps aside for the sidebar (> 768 px, signed in); `main` keeps its own centring. -->
<div class="app-shell" class:has-sidenav={isAuthenticated}>
  <main>
    {#if impersonating && u}
      <div class="impersonation-banner" role="status">
        <span>{m.impersonation_banner({ name: u.name })}</span>
        <button type="button" onclick={() => stopImpersonating()}>{m.impersonation_stop()}</button>
      </div>
    {/if}
    {@render children()}
  </main>
</div>

<ToastContainer />

<ConfirmHost />

<MobileNav />

<Modal
  bind:show={showNavigationWarning}
  title={m.nav_op_title()}
  type="warning"
  confirmText={m.nav_op_leave_anyway()}
  cancelText={m.nav_op_continue()}
  onConfirm={confirmNavigation}
  onCancel={cancelNavigation}
>
  <p>{m.nav_op_body_running()}</p>
  <p>{m.nav_op_body_cancelled()}</p>
  <p><strong>{m.nav_op_body_confirm()}</strong></p>
</Modal>

<style>
  /* Every page, while an admin acts as someone: the way back is on the page they are looking at. */
  .impersonation-banner {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    gap: 0.5rem 1rem;
    padding: 0.5rem 1rem;
    margin: 0.5rem;
    border: 2px solid var(--warning);
    border-radius: var(--radius-xs);
    background: var(--bg-elevated);
    color: var(--text-primary);
    font-size: 0.875rem;
    font-weight: 500;
  }

  .impersonation-banner button {
    padding: 0.25rem 0.75rem;
    border: none;
    border-radius: var(--radius-xs);
    background: var(--bg-tertiary);
    color: var(--text-primary);
    font-weight: 600;
  }
</style>
