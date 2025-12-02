<!--
  MobileNav.svelte - Barre de navigation mobile fixe en bas de l'écran

  Ce composant affiche une barre de navigation en bas de l'écran sur mobile,
  similaire aux applications natives. Il gère automatiquement :
  - L'affichage conditionnel selon les permissions de l'utilisateur
  - L'indication de la page active
  - L'animation de transition entre les pages

  Usage:
    <MobileNav />

  Le composant est automatiquement inclus dans le layout principal.
-->
<script lang="ts">
  import { page } from '$app/state';
  import Icon from './Icon.svelte';
  import type { User } from '$lib/types/api';

  // Dérivation des informations utilisateur depuis le store de page
  let user = $derived((page.data?.session?.user) as User | undefined);
  let isAuthenticated = $derived(!!user);
  let hasPhoto = $derived(!!user?.id_photos);
  let isAdmin = $derived(user?.role === 'admin');
  let isMitviste = $derived(user?.role === 'mitviste');
  let canManagePhotos = $derived(isAdmin || isMitviste);

  // Détermination de la page active pour le style
  let currentPath = $derived(page.url.pathname);

  // Cacher MobileNav sur les pages qui ont leur propre barre d'actions (comme les pages album)
  let isAlbumDetailPage = $derived(currentPath.startsWith('/albums/') && currentPath !== '/albums/');

  /**
   * Vérifie si un lien est actif
   * @param href - Le chemin du lien
   * @param exact - Si true, vérifie une correspondance exacte
   */
  function isActive(href: string, exact = false): boolean {
    if (exact) return currentPath === href;
    return currentPath.startsWith(href);
  }
</script>

{#if isAuthenticated && !isAlbumDetailPage}
  <nav class="mobile-nav" aria-label="Navigation mobile">
    <a href="/albums" class="nav-item" class:active={isActive('/albums')} data-sveltekit-preload-data>
      <Icon name="folder" size={24} />
      <span class="nav-label">Albums</span>
    </a>

    {#if hasPhoto}
      <a href="/mes-photos" class="nav-item" class:active={isActive('/mes-photos')} data-sveltekit-preload-data>
        <Icon name="user" size={24} />
        <span class="nav-label">Mes photos</span>
      </a>
    {/if}

    {#if hasPhoto || canManagePhotos}
      <a href="/photos-cv" class="nav-item" class:active={isActive('/photos-cv')} data-sveltekit-preload-data>
        <Icon name="camera" size={24} />
        <span class="nav-label">Photos CV</span>
      </a>
    {/if}

    {#if isAdmin}
      <a href="/trombinoscope" class="nav-item" class:active={isActive('/trombinoscope')} data-sveltekit-preload-data>
        <Icon name="users" size={24} />
        <span class="nav-label">Trombi</span>
      </a>
    {/if}

    {#if canManagePhotos}
      <a href="/corbeille" class="nav-item" class:active={isActive('/corbeille')} data-sveltekit-preload-data>
        <Icon name="trash" size={24} />
        <span class="nav-label">Corbeille</span>
      </a>
    {/if}

    <a href="/parametres" class="nav-item" class:active={isActive('/parametres')} data-sveltekit-preload-data>
      <Icon name="settings" size={24} />
      <span class="nav-label">Paramètres</span>
    </a>
  </nav>
{/if}

<style>
  .mobile-nav {
    display: none; /* Caché par défaut sur desktop */
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    background: var(--bg-secondary);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border-top: 1px solid var(--border);
    padding: 0.5rem 0;
    padding-bottom: calc(0.5rem + env(safe-area-inset-bottom, 0px)); /* Support iPhone notch */
    z-index: 100;
    box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.15);
  }

  @media (max-width: 768px) {
    .mobile-nav {
      display: flex;
      justify-content: space-around;
      align-items: center;
    }
  }

  .nav-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    padding: 0.5rem 0.75rem;
    color: var(--text-muted);
    text-decoration: none;
    border-radius: var(--radius-sm);
    transition: all 0.2s ease;
    min-width: 60px;
  }

  .nav-item:hover {
    color: var(--text-secondary);
  }

  .nav-item.active {
    color: var(--accent);
  }

  .nav-label {
    font-size: 0.625rem;
    font-weight: 500;
    letter-spacing: 0.01em;
  }

  /* Animation au tap */
  .nav-item:active {
    transform: scale(0.95);
  }
</style>
