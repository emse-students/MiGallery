<script lang="ts">
  import { page } from "$app/state";

  // Vérifier si l'utilisateur a un id_photos configuré
  $: hasIdPhotos = !!((page.data.session?.user as any)?.id_photos);
  $: isFirstLogin = (page.data.session?.user as any)?.first_login === 1;
</script>

<svelte:head>
  <title>MiGallery - Accueil</title>
</svelte:head>

<style>
  main {
    max-width: 1400px;
    margin: 0 auto;
    padding: 20px;
  }

  .header {
    text-align: center;
    margin-bottom: 40px;
  }

  .logo {
    width: 200px;
    height: auto;
    margin-bottom: 20px;
    animation: fadeIn 0.8s ease-in;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
      transform: translateY(-20px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  h1 {
    color: #2c3e50;
    margin: 0;
    font-size: 2.5em;
  }

  .tagline {
    color: #7f8c8d;
    font-size: 1.1em;
    margin-top: 10px;
  }

  .first-login-banner {
    background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
    color: white;
    padding: 25px;
    border-radius: 12px;
    margin-bottom: 30px;
    box-shadow: 0 4px 12px rgba(245, 87, 108, 0.3);
    animation: slideIn 0.5s ease-out;
  }

  @keyframes slideIn {
    from {
      opacity: 0;
      transform: translateY(-10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .banner-content h2 {
    margin-top: 0;
    font-size: 1.5em;
  }

  .banner-content p {
    margin: 15px 0;
    font-size: 1.05em;
    line-height: 1.5;
  }

  .banner-button {
    display: inline-block;
    padding: 12px 24px;
    background: white;
    color: #f5576c;
    text-decoration: none;
    border-radius: 8px;
    font-weight: bold;
    transition: transform 0.2s, box-shadow 0.2s;
    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
  }

  .banner-button:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 10px rgba(0, 0, 0, 0.3);
  }

  .user-section {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 20px;
    border-radius: 12px;
    margin-bottom: 30px;
    box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
  }

  .user-section h3 {
    margin-top: 0;
    font-size: 1.3em;
  }

  .user-section p {
    margin: 8px 0;
  }

  .nav-section {
    background: white;
    padding: 25px;
    border-radius: 12px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    margin-bottom: 30px;
  }

  .nav-section p {
    margin: 0 0 15px 0;
    font-weight: 600;
    color: #2c3e50;
  }

  .nav-section ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 15px;
  }

  .nav-section li a {
    display: block;
    padding: 15px;
    background: linear-gradient(135deg, #3498db 0%, #2980b9 100%);
    color: white;
    text-decoration: none;
    border-radius: 8px;
    text-align: center;
    font-weight: 500;
    transition: transform 0.2s, box-shadow 0.2s;
    box-shadow: 0 2px 5px rgba(52, 152, 219, 0.3);
  }

  .nav-section li a:hover {
    transform: translateY(-3px);
    box-shadow: 0 4px 12px rgba(52, 152, 219, 0.4);
  }

  .disabled-link {
    display: block;
    padding: 15px;
    background: linear-gradient(135deg, #95a5a6 0%, #7f8c8d 100%);
    color: white;
    border-radius: 8px;
    text-align: center;
    font-weight: 500;
    opacity: 0.6;
    cursor: not-allowed;
  }
</style>

<main>
  <div class="header">
    <img src="/MiGallery.png" alt="MiGallery Logo" class="logo" />
    <h1>MiGallery</h1>
    <p class="tagline">by MiTV</p>
  </div>
  
  <!-- Bannière de première connexion -->
  {#if isFirstLogin}
    <div class="first-login-banner">
      <div class="banner-content">
        <h2>🐊 Bienvenue !</h2>
        <p>Pour profiter pleinement de MiGallery, veuillez configurer votre profil dans les paramètres.</p>
        <a href="/parametres" class="banner-button">Configurer mon profil</a>
      </div>
    </div>
  {/if}

  <!-- Section utilisateur actuel -->
  {#if page.data.session?.user}
    <div class="user-section">
      <h3>👤 Utilisateur actuel</h3>
      <p><strong>Nom:</strong> {(page.data.session.user as any).prenom} {(page.data.session.user as any).nom}</p>
      <p><strong>Email:</strong> {page.data.session.user.email}</p>
    </div>
  {/if}

  <div class="nav-section">
    <p>Navigation :</p>
    <ul>
      {#if hasIdPhotos}
        <li><a href="/mes-photos">📸 Mes photos</a></li>
      {:else}
        <li>
          <span class="disabled-link" title="Configurez votre profil dans les paramètres pour accéder à vos photos">
            📸 Mes photos (non disponible)
          </span>
        </li>
      {/if}
      <li><a href="/albums">📁 Albums</a></li>
      <li><a href="/parametres">⚙️ Paramètres</a></li>
    </ul>
  </div>
</main>

