<script lang="ts">
  import { onMount } from 'svelte';

  type KeyRow = { id: number; label?: string; scopes?: string | null; created_at: number };

  let keys: KeyRow[] = $state([]);
  let loading = $state(true);
  let error: string | null = $state(null);

  let newLabel = $state('');
  let newScopes = $state('');
  let creating = $state(false);
  import { showConfirm } from '$lib/confirm';
  import { toast } from '$lib/toast';

  async function loadKeys() {
    loading = true;
    error = null;
    try {
      const res = await fetch('/api/admin/api-keys');
      if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
      const data = (await res.json()) as { keys: KeyRow[] };
      keys = data.keys || [];
    } catch (e: unknown) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  }

  async function createKey() {
    creating = true;
    try {
      const body = { label: newLabel || undefined, scopes: newScopes ? newScopes.split(',').map(s=>s.trim()) : undefined };
      const res = await fetch('/api/admin/api-keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
      const data = (await res.json()) as { id: number; rawKey: string };
      // rawKey is returned once; show it to admin in a modal so they can copy it
      await showConfirm('Clé créée:\nID: ' + data.id + '\n\nClé (copiez-la maintenant, elle ne sera plus affichée):\n' + data.rawKey, 'Clé créée');
      newLabel = '';
      newScopes = '';
      await loadKeys();
    } catch (e: unknown) {
      toast.error('Erreur lors de la création: ' + (e as Error).message);
    } finally {
      creating = false;
    }
  }

  async function deleteKey(id: number) {
    const ok = await showConfirm('Supprimer définitivement cette clé ?\nCette action est irréversible.', 'Supprimer la clé');
    if (!ok) return;
    try {
      const res = await fetch(`/api/admin/api-keys/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
      toast.success('Clé supprimée');
      await loadKeys();
    } catch (e: unknown) {
      toast.error('Erreur: ' + (e as Error).message);
    }
  }

  onMount(() => { loadKeys(); });
</script>

<svelte:head>
  <title>Admin — API Keys</title>
</svelte:head>

<main>
  <h1>Gestion des clés API</h1>
  <p class="subtitle">Créez et gérez les clés pour accéder à l'API externe</p>

  {#if error}
    <div class="error">{error}</div>
  {/if}

  {#if loading}
    <div class="loading">Chargement…</div>
  {:else}
    <section class="card create">
      <h2>Créer une clé</h2>
      <div class="form-row">
        <input placeholder="Label (ex: portail-service)" bind:value={newLabel} />
  <input placeholder="Scopes (csv, ex: read,write)" bind:value={newScopes} />
  <button class="primary" onclick={createKey} disabled={creating}>{creating ? 'Création…' : 'Créer'}</button>
      </div>
      <small>La clé brute est affichée une seule fois après création ; conservez-la.</small>
    </section>

    <section class="card list">
      <div class="section-header">
        <h2>Clés existantes</h2>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>ID</th><th>Label</th><th>Scopes</th><th>Créée</th><th>Actions</th></tr></thead>
          <tbody>
            {#each keys as k}
              <tr>
                <td>{k.id}</td>
                <td>{k.label}</td>
                <td>{k.scopes ?? ''}</td>
                <td>{new Date(k.created_at).toLocaleString()}</td>
                <td>
                  <button onclick={() => deleteKey(k.id)}>Supprimer</button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>
  {/if}
</main>

<style>
  table {
    table-layout: fixed;
  }

  th:nth-child(1), td:nth-child(1) { width: 8%; }
  th:nth-child(2), td:nth-child(2) { width: 25%; }
  th:nth-child(3), td:nth-child(3) { width: 22%; }
  th:nth-child(4), td:nth-child(4) { width: 22%; }
  th:nth-child(5), td:nth-child(5) { width: 23%; }

  th {
    word-break: break-word;
    overflow-wrap: break-word;
  }

  td {
    word-break: break-word;
    overflow-wrap: break-word;
    overflow: hidden;
  }
</style>
