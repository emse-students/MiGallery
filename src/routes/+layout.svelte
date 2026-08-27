<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { activeOperations } from '$lib/operations';
  import { navigationModalStore } from '$lib/navigation-store';
  import { theme } from '$lib/theme';
  import type { User } from '$lib/types/api';
  import { Folder, User as UserIcon, Camera, Settings, LogIn } from '@lucide/svelte';
  import ToastContainer from '$lib/components/ToastContainer.svelte';
  import Modal from '$lib/components/Modal.svelte';
  import ConfirmHost from '$lib/components/ConfirmHost.svelte';
  import MobileNav from '$lib/components/MobileNav.svelte';
  import ThemeToggle from '$lib/components/ThemeToggle.svelte';
  import LocaleToggle from '$lib/components/LocaleToggle.svelte';
  import Seo from '$lib/components/Seo.svelte';
  import { siteSeo, type SeoMeta } from '$lib/seo';
  import { m } from '$lib/paraglide/messages';
  import { loginUrlWithRedirect, REDIRECT_PARAM } from '$lib/auth-redirect';
  import '../app.css';

  let u = $derived(page.data?.session?.user as User);

  // One head for the whole app. A page contributes its card by returning `seo` from its `load`
  // (only the album page does - it is the only URL anybody shares); everything else falls back to
  // the gallery's own. Emitting it here rather than per page is what keeps a single og:title in
  // the document: two of any of these tags is an unfurler picking one at random.
  let seo = $derived((page.data as { seo?: SeoMeta }).seo ?? siteSeo());
  let isAuthenticated = $derived(!!u);
  let isHomePage = $derived(page.url.pathname === '/');

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

  async function handleSignOut() {
    try {
      await fetch('/api/change-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: null }),
      });
    } catch (e: unknown) {
      console.warn('Failed to clear user cookie:', e);
    }

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

<svelte:head>
  <link rel="icon" type="image/png" sizes="32x32" href="/icon.png" />
  <meta name="theme-color" content="#3b82f6" />
</svelte:head>

<!--
	The `<title>` element stays with the pages, and every route sets one. This layout also carried
	`<title>MiGallery</title>`, which never reached a single page: Svelte deduplicates `<title>` in
	`<svelte:head>` and the page's wins, so the layout read as the source of a title it never
	supplied. Verified on prod - `/` served exactly one, `MiGallery - Accueil`.
-->
<Seo meta={seo} />

<nav class="topbar">
  <div class="brand">
    <img src="/icon.png" alt="MiGallery" class="logo" fetchpriority="high" />
    <a href="/">MiGallery</a>
  </div>

  <div class="links">
    {#if isAuthenticated}
      <div class="links-left">
        <a href="/albums" data-sveltekit-preload-data>
          <Folder size={18} />
          <span class="link-text">{m.nav_albums()}</span>
        </a>
        <a href="/mes-photos" data-sveltekit-preload-data>
          <UserIcon size={18} />
          <span class="link-text">{m.nav_my_photos()}</span>
        </a>
        <a href="/photos-cv" data-sveltekit-preload-data>
          <Camera size={18} />
          <span class="link-text">{m.nav_photos_cv()}</span>
        </a>
      </div>

      <div class="links-right">
        <a href="/parametres">
          <Settings size={18} />
          <span class="link-text">{m.nav_settings()}</span>
        </a>
      </div>
    {/if}
  </div>

  <div class="nav-separator"></div>

  <div class="user">
    {#if u}
      <a href="/mes-photos" class="avatar-link">
        <div class="avatar" title={u.name || `${u.first_name || ''} ${u.last_name || ''}`.trim()}>
          {#if u.photos_id}
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
      <button type="button" class="btn-login" onclick={() => handleSignIn()}>{m.nav_login()}</button
      >
    {/if}
  </div>
</nav>

<main>
  {@render children()}
</main>

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
  {#snippet children()}
    <p>{m.nav_op_body_running()}</p>
    <p>{m.nav_op_body_cancelled()}</p>
    <p><strong>{m.nav_op_body_confirm()}</strong></p>
  {/snippet}
</Modal>

<style>
</style>
