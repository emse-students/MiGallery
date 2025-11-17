<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';

  type KeyRow = { id: number; label?: string; scopes?: string | null; revoked: number; created_at: number };

  let keys: KeyRow[] = $state([]);
  let loading = $state(true);
  let error: string | null = $state(null);

  let newLabel = $state('');
  let newScopes = $state('');
  let creating = $state(false);

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
  <div class="header-row">
    <h1>Clés API</h1>
    <div class="hint">Administration · gardez les clés en sécurité</div>
  </div>

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
      <h2>Clés existantes</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>ID</th><th>Label</th><th>Scopes</th><th>Créée</th><th>Révoquée</th><th>Actions</th></tr></thead>
          <tbody>
            {#each keys as k}
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
  main { 
    display: block; 
    padding: 0;
  }
  
  .header-row { 
    display: flex; 
    justify-content: space-between; 
    align-items: center; 
    margin-bottom: 1.5rem;
  }
  
  .header-row h1 {
    font-size: 1.75rem;
    font-weight: 700;
    margin: 0;
  }
  
  .hint { 
    color: var(--text-muted);
    font-size: 0.875rem;
  }
  
  .card { 
    background: var(--bg-tertiary); 
    border: 1px solid var(--border); 
    padding: 1.5rem; 
    border-radius: var(--radius-sm); 
    margin-bottom: 1.5rem;
  }
  
  .card h2 {
    font-size: 1.25rem;
    font-weight: 600;
    margin: 0 0 1rem 0;
    color: var(--text-primary);
  }
  
  .form-row { 
    display: flex; 
    gap: 0.75rem; 
    align-items: center;
    margin-bottom: 0.75rem;
  }
  
  input { 
    flex: 1;
    padding: 0.625rem 0.875rem; 
    border: 1px solid var(--border); 
    border-radius: var(--radius-xs);
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: 0.9375rem;
    transition: all 0.2s var(--ease);
  }
  
  input:focus {
    outline: none;
    border-color: var(--accent);
    background: var(--bg-primary);
  }
  
  input::placeholder {
    color: var(--text-muted);
  }
  
  .primary { 
    background: var(--accent); 
    color: white; 
    border: none; 
    padding: 0.625rem 1.25rem; 
    border-radius: var(--radius-xs);
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s var(--ease);
    white-space: nowrap;
  }
  
  .primary:hover:not(:disabled) {
    background: var(--accent-hover);
    transform: translateY(-1px);
  }
  
  .primary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  
  small {
    color: var(--text-muted);
    font-size: 0.875rem;
  }
  
  .table-wrap { 
    overflow-x: auto;
    margin-top: 1rem;
  }
  
  table { 
    width: 100%; 
    border-collapse: collapse;
  }
  
  th {
    background: var(--bg-secondary);
    border-bottom: 2px solid var(--border); 
    padding: 0.875rem 1rem; 
    text-align: left;
    font-weight: 600;
    font-size: 0.875rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  
  td {
    border-bottom: 1px solid var(--divider); 
    padding: 0.875rem 1rem; 
    color: var(--text-secondary);
  }
  
  tr:hover td {
    background: var(--bg-secondary);
  }
  
  button {
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    padding: 0.4rem 0.875rem;
    border-radius: var(--radius-xs);
    color: var(--text-primary);
    cursor: pointer;
    font-size: 0.875rem;
    font-weight: 500;
    transition: all 0.2s var(--ease);
  }
  
  button:hover {
    background: var(--error);
    border-color: var(--error);
    color: white;
  }
  
  .error { 
    color: var(--error); 
    background: rgba(239, 68, 68, 0.1);
    padding: 0.875rem 1rem;
    border-radius: var(--radius-xs);
    border: 1px solid rgba(239, 68, 68, 0.3);
    margin-bottom: 1rem;
    font-weight: 500;
  }
  
  .loading {
    color: var(--text-muted);
    text-align: center;
    padding: 2rem;
    font-style: italic;
  }
</style>
