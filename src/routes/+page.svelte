<script lang="ts">
  import { page } from "$app/state";
  import type { User } from "$lib/types/api";
  import Icon from "$lib/components/Icon.svelte";
  import BackgroundBlobs from '$lib/components/BackgroundBlobs.svelte';
  import { fade, fly } from "svelte/transition";
	import { signIn} from "@auth/sveltekit/client";

  let user = $derived(page.data.session?.user as User | undefined);
  let isAuthenticated = $derived(!!user);
  let hasIdPhotos = $derived(!!user?.id_photos);

  const hour = new Date().getHours();
  const greeting = hour < 18 ? "Bonjour" : "Bonsoir";

  async function handleSignIn() {
		const data = await signIn('cas-emse', { redirect: false, callbackUrl: window.location.href });
		if (data?.url) window.location.href = data.url;
	}
</script>

<svelte:head>
  <title>MiGallery - Accueil</title>
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
        <div class="card glass-card">
          <h2>Bienvenue sur MiGallery</h2>
          <p>Connectez-vous pour accéder à vos photos.</p>
          <button onclick={() => handleSignIn()} class="btn btn-primary">
            <Icon name="log-in" size={20} /> Se connecter
		  </button>
        </div>

      {:else if !hasIdPhotos}
        <div class="card glass-card warning">
          <div class="icon-wrapper">
             <Icon name="user-plus" size={32} />
          </div>
          <h2>{greeting} {user?.prenom || ''} !</h2>
          <p>Pour profiter pleinement de MiGallery, veuillez terminer la configuration de votre profil.</p>
          <a href="/parametres" class="btn btn-warning">
            Configurer mon profil
          </a>
        </div>

      {:else}
        <div class="glass-card card">
          <h2>{greeting} {user?.prenom || ''} !</h2>
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
    filter: drop-shadow(0 0 20px rgba(255, 255, 255, 0.2));
  }

  h1 {
    font-size: 3rem;
    font-weight: 800;
    margin: 0.5rem 0 0;
    background: linear-gradient(to right, var(--text-primary, #fff), var(--text-secondary, #cbd5e1));
    background-clip: text;
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }

  .tagline {
    font-size: 1.2rem;
    color: var(--text-secondary, #94a3b8);
    margin-top: 0;
    letter-spacing: 2px;
    text-transform: uppercase;
  }

  /* --- Glass Cards --- */
  .card {
    padding: 2rem;
    border-radius: 1.5rem;
    text-align: center;
    transition: transform 0.3s ease;
  }

  .glass-card {
    background: var(--glass-bg);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1px solid var(--glass-border);
    box-shadow: 0 4px 30px rgba(0, 0, 0, 0.1);
  }

  .glass-card:hover {
    transform: translateY(-5px);
    border-color: var(--glass-border-hover);
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

  /* --- Buttons --- */
  .btn {
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1.5rem;
    border-radius: 0.75rem;
    text-decoration: none;
    font-weight: 600;
    transition: all 0.2s;
    border: none;
    cursor: pointer;
  }

  .btn-primary {
    background: var(--accent);
    color: white;
    box-shadow: 0 0 15px color-mix(in srgb, var(--accent) 40%, transparent);
  }
  .btn-primary:hover { background: var(--accent-hover); transform: scale(1.05); }

  .btn-warning {
    background: var(--warning);
    color: #0f172a;
    box-shadow: 0 0 15px color-mix(in srgb, var(--warning) 40%, transparent);
  }
  .btn-warning:hover { background: color-mix(in srgb, var(--warning) 80%, black); transform: scale(1.05); }

  .icon-wrapper {
    margin-bottom: 1rem;
    color: var(--warning);
  }
</style>
