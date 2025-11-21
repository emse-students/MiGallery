<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import type { Album } from '$lib/types/api';

  let { data } = $props();

  let albums: Album[] = $state<Album[]>(data.albums || []);
  let editingAlbumId = $state<string | null>(null);
  let editingAlbumData = $state({ id: '', name: '', date: '', location: '', visibility: 'private', visible: false, tags: '', allowed_users: '' });
  let editingAlbumExistingTags = $state<string[]>([]);
  let editingAlbumExistingUsers = $state<string[]>([]);

  async function loadAlbums() {
    const res = await fetch('/api/db', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sql: 'SELECT * FROM albums ORDER BY date DESC, name ASC' }) });
    const json = (await res.json()) as { success: boolean; data: Album[] };
    if (json.success) albums = json.data;
  }

  function startEditAlbum(a: Album) {
    editingAlbumId = a.id;
    (async () => {
      const tagsRes = await fetch('/api/db', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sql: 'SELECT tag FROM album_tag_permissions WHERE album_id = ?', params: [a.id] }) });
      const tagsJson = (await tagsRes.json()) as { success: boolean; data: { tag: string }[] };
      const tagsArr = tagsJson.success ? (tagsJson.data || []).map((r) => r.tag) : [];

      const usersRes = await fetch('/api/db', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sql: 'SELECT id_user FROM album_user_permissions WHERE album_id = ?', params: [a.id] }) });
      const usersJson = (await usersRes.json()) as { success: boolean; data: { id_user: string }[] };
      const usersArr = usersJson.success ? (usersJson.data || []).map((r) => r.id_user) : [];

      editingAlbumExistingTags = tagsArr;
      editingAlbumExistingUsers = usersArr;
      editingAlbumData = { id: a.id, name: a.name, date: a.date || '', location: a.location || '', visibility: a.visibility || 'private', visible: a.visible === 1, tags: tagsArr.join(', '), allowed_users: usersArr.join(', ') };
    })();
  }

  function cancelEditAlbum() { editingAlbumId = null; }

  async function saveAlbumEdit() {
    if (!editingAlbumId) return;
    const id = editingAlbumId;
    await fetch('/api/db', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sql: 'UPDATE albums SET name = ?, date = ?, location = ?, visibility = ?, visible = ? WHERE id = ?', params: [editingAlbumData.name, editingAlbumData.date || null, editingAlbumData.location || null, editingAlbumData.visibility || 'private', editingAlbumData.visible ? 1 : 0, id] }) });

    const desiredTags = editingAlbumData.tags ? editingAlbumData.tags.split(',').map((t: string) => t.trim()).filter(Boolean) : [];
    const toAddTags = desiredTags.filter(t => !editingAlbumExistingTags.includes(t));
    const toRemoveTags = editingAlbumExistingTags.filter(t => !desiredTags.includes(t));
    for (const t of toAddTags) await fetch('/api/db', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sql: 'INSERT OR IGNORE INTO album_tag_permissions (album_id, tag) VALUES (?, ?)', params: [id, t] }) });
    for (const t of toRemoveTags) await fetch('/api/db', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sql: 'DELETE FROM album_tag_permissions WHERE album_id = ? AND tag = ?', params: [id, t] }) });

    const desiredUsers = editingAlbumData.allowed_users ? editingAlbumData.allowed_users.split(',').map((u: string) => u.trim()).filter(Boolean) : [];
    const toAddUsers = desiredUsers.filter(u => !editingAlbumExistingUsers.includes(u));
    const toRemoveUsers = editingAlbumExistingUsers.filter(u => !desiredUsers.includes(u));
    for (const u of toAddUsers) await fetch('/api/db', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sql: 'INSERT OR IGNORE INTO album_user_permissions (album_id, id_user) VALUES (?, ?)', params: [id, u] }) });
    for (const u of toRemoveUsers) await fetch('/api/db', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sql: 'DELETE FROM album_user_permissions WHERE album_id = ? AND id_user = ?', params: [id, u] }) });

    editingAlbumExistingTags = desiredTags;
    editingAlbumExistingUsers = desiredUsers;
    editingAlbumId = null;
    await loadAlbums();
  }

  async function deleteAlbum(albumId: string) {
    if (!confirm('Supprimer cet album ? Cette action est irréversible.')) return;
    await fetch('/api/db', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sql: 'DELETE FROM albums WHERE id = ?', params: [albumId] }) });
    await loadAlbums();
  }

  async function importAlbumsFromImmich() {
    try {
      const res = await fetch('/api/immich/albums');
      if (!res.ok) { alert(`Erreur récupération albums Immich: ${res.status} ${res.statusText}`); return; }
      const list = (await res.json()) as any[];
      if (!Array.isArray(list)) { alert('Réponse Immich inattendue'); return; }
      let added = 0;
      for (const a of list) {
        const immichId = a.id || a.albumId || a.album_id || a._id || null;
        if (!immichId) continue;
        let name = a.name || a.title || a.albumName || String(immichId || '');
        let dateVal = null;
        const m = name.match(/^([0-9]{4}-[0-9]{2}-[0-9]{2})\s*(.*)$/);
        if (m) { dateVal = m[1]; name = m[2] || name; }
        await fetch('/api/db', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sql: 'INSERT OR IGNORE INTO albums (id, name, date, location, visibility, visible) VALUES (?, ?, ?, ?, ?, ?)', params: [immichId, name, dateVal, null, 'private', 1] }) });
        added++;
      }
      alert(`Import terminé : ${added} albums importés (visibilité=private)`);
      await loadAlbums();
    } catch (err: unknown) { console.error('Import albums error', err); alert('Erreur lors de l\'import des albums. Voir la console.'); }
  }

  onMount(() => { loadAlbums(); });
</script>

<svelte:head>
  <title>Admin — Gestion des albums</title>
</svelte:head>

<main>
  <div class="header-row">
    <h1>Gestion des albums</h1>
    <div class="hint">Administrateur — importer / gérer les albums</div>
  </div>

  <section class="card">
    <button onclick={importAlbumsFromImmich} class="mb-4 bg-gray-600 hover:bg-gray-700 text-white px-3 py-2 rounded">Importer depuis Immich</button>
    <h3 class="mb-4 mt-4">Albums existants</h3>
    {#if albums.length > 0}
      <div class="table-wrap">
        <table>
          <thead><tr><th>ID</th><th>Name</th><th>Date</th><th>Location</th><th>Visibility</th><th>Visible</th><th>Actions</th></tr></thead>
          <tbody>
            {#each albums as a}
              <tr>
                {#if editingAlbumId === a.id}
                  <td>{a.id}</td>
                  <td><input type="text" bind:value={editingAlbumData.name} /></td>
                  <td><input type="date" bind:value={editingAlbumData.date} /></td>
                  <td><input type="text" bind:value={editingAlbumData.location} /></td>
                  <td>
                    <select bind:value={editingAlbumData.visibility}><option value="private">Privé</option><option value="authenticated">Public (auth)</option><option value="unlisted">Accès par lien</option></select>
                  </td>
                  <td><input type="checkbox" bind:checked={editingAlbumData.visible} /></td>
                  <td><button onclick={saveAlbumEdit} class="success-button">Save</button><button onclick={cancelEditAlbum} class="ml-2">Cancel</button></td>
                {:else}
                  <td>{a.id}</td>
                  <td>{a.name}</td>
                  <td>{a.date ?? '-'}</td>
                  <td>{a.location ?? '-'}</td>
                  <td>{a.visibility}</td>
                  <td>{a.visible ? 'Oui' : 'Non'}</td>
                  <td><button onclick={() => window.open(`/albums/${a.id}`, '_blank')}>Open</button><button onclick={() => startEditAlbum(a)} class="ml-2">Edit</button><button onclick={() => deleteAlbum(a.id)} class="ml-2 bg-red-600 text-white">Delete</button></td>
                {/if}
              </tr>
              {#if editingAlbumId === a.id}
                <tr><td colspan="7"><div class="flex gap-3 items-center"><label for="tags-{a.id}" class="min-w-[80px]">Tags:</label><input id="tags-{a.id}" class="flex-1" type="text" bind:value={editingAlbumData.tags} placeholder="Ex: Promo 2024, VIP" /><label for="users-{a.id}" class="min-w-[120px]">Allowed users (comma):</label><input id="users-{a.id}" class="flex-1" type="text" bind:value={editingAlbumData.allowed_users} placeholder="ex: alice.bob, john.doe" /></div><p class="mt-2 text-gray-600 text-sm">Ajoutez des tags et des id_user autorisés. Cliquez sur Save pour appliquer.</p></td></tr>
              {/if}
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <p>Aucun album pour le moment.</p>
    {/if}
  </section>
</main>

<style>
  :global(.table-wrap) {
    overflow-x: auto !important;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    min-width: 1000px;
  }

  th:nth-child(1), td:nth-child(1) { width: 10%; }
  th:nth-child(2), td:nth-child(2) { width: 18%; }
  th:nth-child(3), td:nth-child(3) { width: 12%; }
  th:nth-child(4), td:nth-child(4) { width: 15%; }
  th:nth-child(5), td:nth-child(5) { width: 13%; }
  th:nth-child(6), td:nth-child(6) { width: 10%; }
  th:nth-child(7), td:nth-child(7) { width: 22%; }

  th, td {
    padding: 0.75rem 0.5rem;
    text-align: left;
    border-bottom: 1px solid var(--divider);
    word-break: break-word;
    overflow-wrap: break-word;
  }

  th {
    background: var(--bg-secondary);
    font-weight: 600;
    border-bottom: 2px solid var(--border);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  td {
    vertical-align: middle;
    overflow: hidden;
  }

  td:last-child {
    white-space: nowrap;
  }

  button {
    padding: 0.4rem 0.6rem;
    font-size: 0.8125rem;
    margin-right: 0.25rem;
  }

  button:last-child {
    margin-right: 0;
  }
</style>
