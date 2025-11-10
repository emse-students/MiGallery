<script lang="ts">
  import { page } from "$app/state";
  import Icon from "$lib/components/Icon.svelte";

  // Vérifier si l'utilisateur a un id_photos configuré
  let hasIdPhotos = $derived(!!((page.data.session?.user as any)?.id_photos));
  let isFirstLogin = $derived((page.data.session?.user as any)?.first_login === 1);
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
  {#if isFirstLogin}
    <div class="first-login-banner">
      <div class="banner-content">
        <h2><Icon name="user" size={32} /> Bienvenue !</h2>
        <p>Pour profiter pleinement de MiGallery, veuillez configurer votre profil dans les paramètres.</p>
        <a href="/parametres" class="banner-button">Configurer mon profil</a>
      </div>
    </div>
  {/if}

  <!-- Section utilisateur actuel -->
  {#if page.data.session?.user}
    <div class="user-section">
      <h3><Icon name="user" size={24} /> Utilisateur actuel</h3>
      <p><strong>Nom:</strong> {(page.data.session.user as any).prenom} {(page.data.session.user as any).nom}</p>
      <p><strong>Email:</strong> {page.data.session.user.email}</p>
    </div>
  {/if}

  <div class="nav-section">
    <p>Navigation :</p>
    <ul>
      {#if hasIdPhotos}
        <li><a href="/mes-photos"><Icon name="image" size={20} /> Mes photos</a></li>
      {:else}
        <li>
          <span class="disabled-link" title="Configurez votre profil dans les paramètres pour accéder à vos photos">
            <Icon name="image" size={20} /> Mes photos (non disponible)
          </span>
        </li>
      {/if}
      <li><a href="/photos-cv"><Icon name="image" size={20} /> Photos CV</a></li>
      <li><a href="/albums"><Icon name="folder" size={20} /> Albums</a></li>
      <li><a href="/parametres"><Icon name="settings" size={20} /> Paramètres</a></li>
    </ul>
  </div>
</main>

