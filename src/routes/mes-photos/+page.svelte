<script lang="ts">
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import { onMount, onDestroy } from 'svelte';

  type Asset = { id: string; originalFileName?: string };

  let assets: Asset[] = [];
  let loading = false;
  let error: string | null = null;
  let imageUrl: string | null = null;
  let _prevImageUrl: string | null = null;
  let personName: string = '';
  let peopleId: string = '';

  async function loadPerson(id: string) {
    if (!id) {
      error = "Aucun id_photos configuré pour cet utilisateur";
      return;
    }
    
    loading = true; error = null; assets = []; imageUrl = null; personName = '';
    
    try {
      // Récupérer les infos de la personne
      const personRes = await fetch(`/api/immich/people/${id}`);
      if (personRes.ok) {
        const personData = await personRes.json();
        personName = personData.name || 'Sans nom';
      }

      // Récupérer la miniature de la personne
      const thumb = await fetch(`/api/immich/people/${id}/thumbnail`);
      if (thumb.ok) {
        const blob = await thumb.blob();
        // revoke previous blob URL if any
        if (_prevImageUrl) {
          try { URL.revokeObjectURL(_prevImageUrl); } catch (e) {}
          _prevImageUrl = null;
        }
        const url = URL.createObjectURL(blob);
        imageUrl = url;
        _prevImageUrl = url;
      }

      // Récupérer toutes les photos de cette personne
      const res = await fetch('/api/immich/search/metadata', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ personIds: [id], type: 'IMAGE', page: 1, size: 1000 })
      });
      
      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        try {
          const parsed = JSON.parse(text);
          throw new Error(parsed?.error || parsed?.message || String(text));
        } catch {
          throw new Error(text || res.statusText);
        }
      }
      
      const data = await res.json();
      const items = (data && data.assets && Array.isArray(data.assets.items)) 
        ? data.assets.items 
        : (Array.isArray(data) ? data : (Array.isArray(data.data) ? data.data : []));
      
      assets = items.map((it: any) => ({ id: it.id, originalFileName: it.originalFileName }));
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  }

  onDestroy(() => {
    if (_prevImageUrl) {
      try { URL.revokeObjectURL(_prevImageUrl); } catch (e) {}
      _prevImageUrl = null;
    }
  });

  onMount(() => {
    // Vérifier si l'utilisateur a un id_photos configuré
    const user = page.data.session?.user as any;
    if (!user || !user.id_photos) {
      // Rediriger vers la page d'accueil si pas d'id_photos
      goto('/');
      return;
    }

    peopleId = user.id_photos;
    loadPerson(peopleId);
  });
</script>

<svelte:head>
  <title>Mes photos - MiGallery</title>
  <style>
    * {
      box-sizing: border-box;
    }
  </style>
</svelte:head>

<style>
  main {
    max-width: 1400px;
    margin: 0 auto;
    padding: 20px;
  }

  nav {
    margin-bottom: 30px;
  }

  nav a {
    text-decoration: none;
    color: #3498db;
    font-size: 1.1em;
  }

  nav a:hover {
    text-decoration: underline;
  }

  .user-info {
    background: #f8f9fa;
    padding: 20px;
    border-radius: 10px;
    margin-bottom: 30px;
    display: flex;
    align-items: center;
    gap: 20px;
  }

  .user-portrait {
    width: 100px;
    height: 100px;
    border-radius: 50%;
    object-fit: cover;
    border: 3px solid #3498db;
  }

  .user-details h2 {
    margin: 0 0 10px 0;
    color: #2c3e50;
  }

  .user-details p {
    margin: 5px 0;
    color: #7f8c8d;
  }

  .loading, .error {
    padding: 20px;
    text-align: center;
    font-size: 1.1em;
  }

  .loading {
    color: #3498db;
  }

  .error {
    color: #e74c3c;
    background: #fadbd8;
    border-radius: 8px;
  }

  .photos-count {
    margin: 20px 0;
    font-size: 1.2em;
    color: #2c3e50;
  }

  .photos-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
    gap: 20px;
    margin-top: 20px;
  }

  .photo-card {
    background: white;
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    transition: transform 0.2s, box-shadow 0.2s;
  }

  .photo-card:hover {
    transform: translateY(-5px);
    box-shadow: 0 4px 16px rgba(0,0,0,0.15);
  }

  .photo-card img {
    width: 100%;
    height: 250px;
    object-fit: cover;
    display: block;
  }

  .photo-info {
    padding: 12px;
    font-size: 0.9em;
    color: #7f8c8d;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>

<main>
  <nav><a href="/">← Accueil</a></nav>

  {#if imageUrl && personName}
    <div class="user-info">
      <img src={imageUrl} alt="Portrait" class="user-portrait" />
      <div class="user-details">
        <h2>📸 Photos de {personName}</h2>
        <p><strong>Utilisateur:</strong> {(page.data.session?.user as any)?.prenom} {(page.data.session?.user as any)?.nom}</p>
        <p><strong>ID Person:</strong> <code>{peopleId}</code></p>
      </div>
    </div>
  {/if}

  {#if error}
    <div class="error">❌ {error}</div>
  {/if}

  {#if loading}
    <div class="loading">⏳ Chargement des photos...</div>
  {/if}

  {#if assets.length > 0}
    <div class="photos-count">
      <strong>{assets.length}</strong> photo{assets.length > 1 ? 's' : ''} trouvée{assets.length > 1 ? 's' : ''}
    </div>

    <div class="photos-grid">
      {#each assets as a}
        <div class="photo-card">
          <img 
            alt={a.originalFileName || a.id} 
            src={`/api/immich/assets/${a.id}/thumbnail?size=thumbnail&t=${Date.now()}`} 
          />
          <div class="photo-info" title={a.originalFileName || a.id}>
            {a.originalFileName || a.id}
          </div>
        </div>
      {/each}
    </div>
  {:else if !loading && !error}
    <div class="loading">Aucune photo trouvée</div>
  {/if}
</main>
