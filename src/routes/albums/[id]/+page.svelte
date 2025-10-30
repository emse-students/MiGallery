<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';

  let loading = $state(false);
  let error = $state<string | null>(null);
  let title = $state('');
  type Asset = { id: string; originalFileName?: string };
  let assets = $state<Asset[]>([]);

  async function fetchAlbum(id: string) {
    loading = true; error = null; title = ''; assets = [];
    try {
      const res = await fetch(`/api/immich/albums/${id}`);
      if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
      const data = await res.json();
  title = data.albumName;
      const list: any[] = Array.isArray(data?.assets) ? data.assets : [];
  assets = list.map((a: any) => ({ id: a.id as string, originalFileName: String(a.originalFileName) })).filter(a => !!a.id);
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    const id = $page.params.id as string | undefined;
    if (id) fetchAlbum(id);
  });
</script>

<svelte:head>
  <title>{title || 'Album'} - MiGallery</title>
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

  h1 {
    color: #2c3e50;
    margin-bottom: 30px;
  }

  .loading, .error {
    padding: 20px;
    text-align: center;
    font-size: 1.1em;
    border-radius: 8px;
  }

  .loading {
    color: #3498db;
    background: #ebf5fb;
  }

  .error {
    color: #e74c3c;
    background: #fadbd8;
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

  .empty-state {
    text-align: center;
    padding: 60px 20px;
    color: #7f8c8d;
  }

  .empty-state p {
    font-size: 1.2em;
    margin: 20px 0;
  }
</style>

<main>
  <nav><a href="/albums">← Retour aux albums</a></nav>
  
  <h1>📸 {title || 'Album'}</h1>
  
  {#if error}
    <div class="error">❌ Erreur: {error}</div>
  {/if}
  
  {#if loading}
    <div class="loading">⏳ Chargement des photos...</div>
  {/if}
  
  {#if !loading && !error && assets.length === 0}
    <div class="empty-state">
      <p>Aucune photo dans cet album</p>
    </div>
  {/if}
  
  {#if assets.length > 0}
    <div class="photos-count">
      <strong>{assets.length}</strong> photo{assets.length > 1 ? 's' : ''} dans cet album
    </div>

    <div class="photos-grid">
      {#each assets as a}
        <div class="photo-card">
          <img 
            alt={a.originalFileName} 
            src={`/api/immich/assets/${a.id}/thumbnail?size=thumbnail&t=${Date.now()}`} 
          />
          <div class="photo-info" title={a.originalFileName}>
            {a.originalFileName}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</main>
