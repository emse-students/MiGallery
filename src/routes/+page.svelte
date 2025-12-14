<script lang="ts">
  import { page } from "$app/state";
  import type { User } from "$lib/types/api";
  import Icon from "$lib/components/Icon.svelte";
  import { fade, fly } from "svelte/transition";
	import { signIn} from "@auth/sveltekit/client";

  // Récupération réactive de l'utilisateur (Svelte 5)
  let user = $derived(page.data.session?.user as User | undefined);
  let isAuthenticated = $derived(!!user);
  let hasIdPhotos = $derived(!!user?.id_photos);

  // Déterminer le message d'accueil en fonction de l'heure (optionnel, pour le fun)
  const hour = new Date().getHours();
  const greeting = hour < 18 ? "Bonjour" : "Bonsoir";

  async function handleSignIn() {
		// signIn() gère automatiquement la mécanique CSRF/cookies/redirections
		// Sans callbackUrl, redirige vers la page d'origine après authentification
		await signIn('cas-emse');
	}
</script>



<svelte:head>
  <title>MiGallery - Accueil</title>
</svelte:head>

<main class="home-main">
  <div class="page-background">
    <div class="gradient-blob blob-1"></div>
    <div class="gradient-blob blob-2"></div>
    <div class="gradient-blob blob-3"></div>
    <div class="glass-overlay"></div>
  </div>

  <div class="content-wrapper" in:fade={{ duration: 800 }}>
    <header class="header">
      <div class="logo-container">
        <img src="/MiGallery2.png" alt="MiGallery Logo" class="logo" />
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
  /* --- Layout & Reset --- */
  :global(body) {
    margin: 0;
    font-family: 'Inter', system-ui, sans-serif;
    background-color: #0f172a; /* Bleu nuit très sombre */
    color: white;
    overflow-x: hidden;
  }

  .home-main {
    position: relative;
    min-height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    border-radius: 1.5rem;
  }

  /* --- Background Blobs --- */
  .page-background {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: 0;
    overflow: hidden;
  }

  .gradient-blob {
    position: absolute;
    border-radius: 50%;
    filter: blur(80px);
    opacity: 0.6;
    animation: float 10s infinite ease-in-out;
  }

  .blob-1 { background: #4f46e5; width: 400px; height: 400px; top: -10%; left: -10%; animation-delay: 0s; }
  .blob-2 { background: #db2777; width: 300px; height: 300px; bottom: 10%; right: -5%; animation-delay: 2s; }
  .blob-3 { background: #0ea5e9; width: 350px; height: 350px; top: 40%; left: 40%; animation-delay: 4s; }

  @keyframes float {
    0%, 100% { transform: translate(0, 0) scale(1); }
    33% { transform: translate(30px, -50px) scale(1.1); }
    66% { transform: translate(-20px, 20px) scale(0.9); }
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
    background: linear-gradient(to right, #fff, #cbd5e1);
    background-clip: text;
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }

  .tagline {
    font-size: 1.2rem;
    color: #94a3b8;
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
    background: rgba(255, 255, 255, 0.05);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    box-shadow: 0 4px 30px rgba(0, 0, 0, 0.1);
  }

  .glass-card:hover {
    transform: translateY(-5px);
    border-color: rgba(255, 255, 255, 0.2);
  }

  .card h2 {
    margin-top: 0;
    font-size: 1.5rem;
  }

  .card p {
    color: #cbd5e1;
    margin-bottom: 1.5rem;
    line-height: 1.6;
  }

  /* --- Buttons --- */
  .btn {
    display: inline-flex;
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
    background: #4f46e5;
    color: white;
    box-shadow: 0 0 15px rgba(79, 70, 229, 0.4);
  }
  .btn-primary:hover { background: #4338ca; transform: scale(1.05); }

  .btn-warning {
    background: #eab308;
    color: #0f172a;
    box-shadow: 0 0 15px rgba(234, 179, 8, 0.4);
  }
  .btn-warning:hover { background: #ca8a04; transform: scale(1.05); }

  .icon-wrapper {
    margin-bottom: 1rem;
    color: #eab308;
  }
</style>
