<script lang="ts">
  import { page } from "$app/state";
  import type { User } from "$lib/types/api";
  import Icon from "$lib/components/Icon.svelte";

  // Vérifier si l'utilisateur a un id_photos configuré
  let hasIdPhotos = $derived(!!((page.data.session?.user as User)?.id_photos));
  let isFirstLogin = $derived((page.data.session?.user as User)?.first_login === 1);
</script>

<svelte:head>
  <title>MiGallery - Accueil</title>
</svelte:head>

<main class="home-main">
  <div class="page-background">
    <div class="gradient-blob blob-1"></div>
    <div class="gradient-blob blob-2"></div>
    <div class="gradient-blob blob-3"></div>
  </div>

  <div class="header">
    <img src="/MiGallery.png" alt="MiGallery Logo" class="logo" />
    <h1>MiGallery</h1>
    <p class="tagline">by MiTV</p>
  </div>

  <!-- Bannière de première connexion -->
  {#if !hasIdPhotos}
    <div class="first-login-banner">
      <div class="banner-content">
        <h2><Icon name="user" size={32} /> Bienvenue !</h2>
        <p>Pour profiter pleinement de MiGallery, veuillez configurer votre profil dans les paramètres.</p>
        <a href="/parametres" class="banner-button">Configurer mon profil</a>
      </div>
    </div>
  {/if}

  <!-- Section 'Utilisateur actuel' retirée : gestion limitée à la page Paramètres/admin et au point de debug /dev/login-as -->

  <!-- Navigation section removed from home page as requested -->
</main>
