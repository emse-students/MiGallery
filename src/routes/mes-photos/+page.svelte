<script lang="ts">

  // Very small, explicit viewer: no sorting, no scroll, no session storage.
  // The selected person id is exposed as a variable (`peopleId`) you can change programmatically.

  export let peopleId: string = '';

  type Person = { id: string; name: string };
  type Asset = { id: string; originalFileName?: string };

  import { onMount, onDestroy } from 'svelte';

  let people: Person[] = [];
  let assets: Asset[] = [];
  let loading = false;
  let error: string | null = null;
  let imageUrl: string | null = null;
  let _prevImageUrl: string | null = null;
  let lastLoadedPerson: string = '';

  async function fetchPeople() {
    loading = true; error = null; people = [];
    try {
      const res = await fetch('/api/immich/people');
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
      if (Array.isArray(data)) people = data.map((p: any) => ({ id: p.id, name: p.name }));
      else if (Array.isArray(data.people)) people = data.people.map((p: any) => ({ id: p.id, name: p.name }));
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  }

  async function loadPerson(id: string) {
    if (!id) return;
    // avoid duplicate loads for the same person
    if (id === lastLoadedPerson) return;
    lastLoadedPerson = id;
    loading = true; error = null; assets = []; imageUrl = null;
    try {
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

      const items = (data && data.assets && Array.isArray(data.assets.items)) ? data.assets.items : (Array.isArray(data) ? data : (Array.isArray(data.data) ? data.data : []));
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
    fetchPeople();
    if (peopleId) loadPerson(peopleId);
  });

  $: if (peopleId) {
    loadPerson(peopleId);
  }
</script>

<svelte:head>
  <title>Mes photos</title>
</svelte:head>

<main>
  <nav><a href="/">← Accueil</a></nav>

  <div>
    {#if people.length > 0}
      <select bind:value={peopleId}>
        {#each people as p}
          <option value={p.id}>{p.name}</option>
        {/each}
      </select>
    {:else}
      <div>Chargement des personnes…</div>
    {/if}
  </div>

  {#if imageUrl}
    <div>
      <img src={imageUrl} alt="Portrait" />
    </div>
  {/if}

  {#if error}
    <div>Erreur: {error}</div>
  {/if}

  {#if loading}
    <div>Chargement…</div>
  {/if}

  <div>
    {#each assets as a}
      <div>
        <img alt={a.originalFileName || a.id} src={`/api/immich/assets/${a.id}/thumbnail?size=thumbnail&t=${Date.now()}`} />
        <div>{a.originalFileName || a.id}</div>
      </div>
    {/each}
  </div>
</main>
