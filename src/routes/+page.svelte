<script lang="ts">
  import { page } from '$app/state';
  import type { User } from '$lib/types/api';
  import { LogIn, UserPlus } from '@lucide/svelte';
  import BackgroundBlobs from '$lib/components/BackgroundBlobs.svelte';
  import { fade, fly } from 'svelte/transition';
  import { m } from '$lib/paraglide/messages';
  import { loginUrlWithRedirect, REDIRECT_PARAM } from '$lib/auth-redirect';

  let user = $derived(page.data.session?.user as User | undefined);
  let isAuthenticated = $derived(!!user);
  let hasIdPhotos = $derived(!!user?.photos_id);

  const hour = new Date().getHours();
  const greeting = hour < 18 ? m.greeting_day() : m.greeting_evening();

  function handleSignIn() {
    // A guard that bounced someone here left the page they asked for in the
    // URL - hand it to the login so the round trip comes back to it.
    window.location.href = loginUrlWithRedirect(page.url.searchParams.get(REDIRECT_PARAM));
  }
</script>

<svelte:head>
  <title>{m.home_page_title()}</title>
</svelte:head>

<main class="home-main">
  <BackgroundBlobs />

  <div class="content-wrapper" in:fade={{ duration: 800 }}>
    <header class="header">
      <div class="logo-container">
        <img src="/icon.png" alt="MiGallery Logo" class="logo" fetchpriority="high" />
      </div>
      <h1>MiGallery</h1>
      <p class="tagline">by MiTV</p>
    </header>

    <div class="actions-container" in:fly={{ y: 20, duration: 800, delay: 200 }}>
      {#if !isAuthenticated}
        <div class="card surface">
          <h2>{m.home_welcome_title()}</h2>
          <p>{m.home_welcome_sub()}</p>
          <button type="button" onclick={handleSignIn} class="btn primary">
            <LogIn size={20} />
            {m.home_signin()}
          </button>
        </div>
      {:else if !hasIdPhotos}
        <div class="card surface warning">
          <div class="icon-wrapper">
            <UserPlus size={32} />
          </div>
          <h2>{greeting} {user?.first_name || user?.name || ''} !</h2>
          <p>
            {m.home_finish_profile()}
          </p>
          <a href="/parametres" class="btn warning"> {m.home_configure_profile()} </a>
        </div>
      {:else}
        <div class="surface card">
          <h2>{greeting} {user?.first_name || user?.name || ''} !</h2>
        </div>
      {/if}
    </div>
  </div>
</main>

<style>
  :global(body) {
    margin: 0;
    font-family: 'Inter', system-ui, sans-serif;
    background-color: var(--bg-primary, #0f172a);
    color: var(--text-primary, white);
    overflow-x: hidden;
  }

  .home-main {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    border-radius: 1.5rem;
  }

  /* --- Content --- */
  .content-wrapper {
    position: relative;
    z-index: 10;
    text-align: center;
    padding: 2rem;
    max-width: 600px;
    width: 100%;
  }

  .header {
    margin-bottom: 3rem;
  }

  .logo {
    width: 120px;
    height: auto;
  }

  h1 {
    font-size: 3rem;
    font-weight: 800;
    margin: 0.5rem 0 0;
    color: var(--text-primary);
  }

  .tagline {
    font-size: 1.2rem;
    color: var(--text-secondary, #94a3b8);
    margin-top: 0;
    letter-spacing: 2px;
    text-transform: uppercase;
  }

  /* --- Cards --- */
  .card {
    padding: 2rem;
    border-radius: 1.5rem;
    text-align: center;
    transition: transform 0.3s ease;
  }

  .surface {
    background: var(--surface);
    border: 1px solid var(--surface-border);
  }

  .surface:hover {
    border-color: var(--surface-border-hover);
  }

  .card h2 {
    margin-top: 0;
    font-size: 1.5rem;
    color: var(--text-primary);
  }

  .card p {
    color: var(--text-secondary);
    margin-bottom: 1.5rem;
    line-height: 1.6;
  }

  .icon-wrapper {
    margin-bottom: 1rem;
    color: var(--warning);
  }
</style>
