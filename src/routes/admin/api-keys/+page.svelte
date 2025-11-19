<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';

  type KeyRow = { id: number; label?: string; scopes?: string | null; revoked: number; created_at: number };

  let keys: KeyRow[] = $state([]);
  let loading = $state(true);
  let error: string | null = $state(null);
  let showRevokedOld = $state(false);

  let newLabel = $state('');
  let newScopes = $state('');
  let creating = $state(false);

  const REVOKED_RETENTION_DAYS = 30;

  function isRevokedOld(key: KeyRow): boolean {
    if (!key.revoked) return false;
    const ageMs = Date.now() - (key.created_at * 1000);
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    return ageDays > REVOKED_RETENTION_DAYS;
  }

  function filteredKeys(): KeyRow[] {
    return keys.filter(k => !isRevokedOld(k) || showRevokedOld);
  }

  async function loadKeys() {
    loading = true;
    error = null;
    try {
      const res = await fetch('/api/admin/api-keys');
      if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
      const data = await res.json();
      keys = data.keys || [];
    } catch (e) {
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
      const data = await res.json();
      // rawKey is returned once; show it to admin
      alert('Clé créée:\nID: ' + data.id + '\nClé (copiez-la maintenant, elle ne sera plus affichée):\n' + data.rawKey);
      newLabel = '';
      newScopes = '';
      await loadKeys();
    } catch (e) {
      alert('Erreur lors de la création: ' + (e as Error).message);
    } finally {
      creating = false;
    }
  }

  async function revokeKey(id: number) {
    if (!confirm('Révoquer cette clé ?')) return;
    try {
      const res = await fetch(`/api/admin/api-keys/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
      await loadKeys();
    } catch (e) {
      alert('Erreur: ' + (e as Error).message);
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
        <label class="toggle-old">
          <input type="checkbox" bind:checked={showRevokedOld} />
          <span>Afficher les clés révoquées (> {REVOKED_RETENTION_DAYS}j)</span>
        </label>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>ID</th><th>Label</th><th>Scopes</th><th>Créée</th><th>Révoquée</th><th>Actions</th></tr></thead>
          <tbody>
            {#each filteredKeys() as k}
              <tr>
                <td>{k.id}</td>
                <td>{k.label}</td>
                <td>{k.scopes ?? ''}</td>
                <td>{new Date(k.created_at).toLocaleString()}</td>
                <td>{k.revoked ? 'oui' : 'non'}</td>
                <td>
                  {#if !k.revoked}
                    <button onclick={() => revokeKey(k.id)}>Révoquer</button>
                  {/if}
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
  th:nth-child(2), td:nth-child(2) { width: 20%; }
  th:nth-child(3), td:nth-child(3) { width: 18%; }
  th:nth-child(4), td:nth-child(4) { width: 18%; }
  th:nth-child(5), td:nth-child(5) { width: 12%; }
  th:nth-child(6), td:nth-child(6) { width: 24%; }

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
