<script lang="ts">
  import { page } from "$app/state";

  let idPhotos = $state<string | null>(null);

  async function getIdPhotos() {
    const userId = page.data.session?.user?.id_user;
    
    if (!userId) {
      alert("Pas d'utilisateur connecté");
      return;
    }

    const response = await fetch('/api/db', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sql: "SELECT id_photos FROM users WHERE id_user = ?",
        params: [userId]
      })
    });

    const result = await response.json();
    
    if (result.success && result.data.length > 0) {
      idPhotos = result.data[0].id_photos;
    }
  }
</script>

<svelte:head>
  <title>MiGallery</title>
</svelte:head>

<main>
  <h1>MiGallery</h1>
  <p>Navigation :</p>
  <ul>
    <li><a href="/mes-photos">Mes photos</a></li>
    <li><a href="/albums">Albums</a></li>
  </ul>

  <hr>
  
  <button onclick={getIdPhotos}>Récupérer mon id_photos</button>
  
  {#if idPhotos}
    <p>Votre id_photos : <strong>{idPhotos}</strong></p>
  {/if}
</main>

