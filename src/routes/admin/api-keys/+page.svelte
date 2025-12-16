<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import BackgroundBlobs from '$lib/components/BackgroundBlobs.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import { showConfirm } from '$lib/confirm';
  import { toast } from '$lib/toast';

  type KeyRow = { id: number; label?: string; scopes?: string | null; created_at: number };

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
      const data = (await res.json()) as { keys: KeyRow[] };
      keys = data.keys || [];
    } catch (e: unknown) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  }

  async function createKey() {
    if (!newLabel) {
        toast.error("Un label est requis");
        return;
    }
    creating = true;
    try {
      const body = { label: newLabel || undefined, scopes: newScopes ? newScopes.split(',').map(s=>s.trim()) : undefined };
      const res = await fetch('/api/admin/api-keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
      const data = (await res.json()) as { id: number; rawKey: string };

      await showConfirm(
        `Clé créée avec succès !\n\nID: ${data.id}\nClé: ${data.rawKey}\n\n⚠️ Copiez-la maintenant, elle ne sera plus jamais affichée.`,
        'Clé API générée'
      );

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
    const ok = await showConfirm('Supprimer définitivement cette clé ?\nCette action révoquera immédiatement l\'accès.', 'Supprimer la clé');
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

<main class="admin-main">
  <!-- Fond animé -->
  <BackgroundBlobs />

  <div class="admin-container">
    <header class="page-header">
      <div class="header-icon">
        <Icon name="key" size={32} />
      </div>
      <div class="header-content">
        <h1>Gestion des clés API</h1>
        <p class="subtitle">Gérez les accès externes à l'API MiGallery</p>
      </div>
      <div style="margin-left: auto;">
          <a href="/admin/api-docs" class="btn-glass">
            <Icon name="book" size={16} /> Documentation
          </a>
      </div>
    </header>

    <!-- Section Création -->
    <section class="glass-card create-section">
      <div class="card-header">
        <h3><Icon name="plus-circle" size={20} /> Nouvelle clé</h3>
      </div>
      <div class="card-body">
        <div class="form-row">
            <div class="input-group">
                <label for="key-label">Label</label>
                <input id="key-label" class="input-glass" placeholder="Ex: portail-etu" bind:value={newLabel} />
            </div>
            <div class="input-group flex-1">
                <label for="key-scopes">Scopes (optionnel)</label>
                <input id="key-scopes" class="input-glass" placeholder="Ex: read,write (séparés par virgule)" bind:value={newScopes} />
            </div>
            <div class="input-group button-group">
                <button class="btn-primary" onclick={createKey} disabled={creating || !newLabel}>
                    {#if creating}
                        <Spinner size={18} /> Création...
                    {:else}
                        <Icon name="check" size={18} /> Créer
                    {/if}
                </button>
            </div>
        </div>
        <p class="hint-text"><Icon name="info" size={14} /> La clé brute ne sera affichée qu'une seule fois après la création.</p>
      </div>
    </section>

    {#if error}
        <div class="glass-card p-4 border-l-4 border-red-500 text-red-500 flex items-center gap-2">
            <Icon name="alert-circle" size={20} /> {error}
        </div>
    {/if}

    <!-- Liste des clés -->
    <section class="glass-card list-section">
      <div class="card-header">
        <h3>Clés existantes ({keys.length})</h3>
        <button class="btn-refresh" onclick={loadKeys} disabled={loading} title="Rafraîchir" class:animate-spin={loading}>
            <Icon name="refresh-cw" size={18} />
        </button>
      </div>

      {#if loading && keys.length === 0}
        <div class="empty-state"><Spinner size={32} /> Chargement...</div>
      {:else if keys.length > 0}
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Label</th>
                <th>Scopes</th>
                <th>Créée le</th>
                <th class="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {#each keys as k}
                <tr>
                  <td class="id-cell">#{k.id}</td>
                  <td class="font-medium text-main">{k.label || '-'}</td>
                  <td>
                    {#if k.scopes}
                        <div class="scopes-list">
                        {#each k.scopes.split(',') as scope}
                            <span class="badge scope">{scope.trim()}</span>
                        {/each}
                        </div>
                    {:else}
                        <span class="badge all">Tous</span>
                    {/if}
                  </td>
                  <td class="text-sm text-muted">{new Date(k.created_at).toLocaleString()}</td>
                  <td class="text-right">
                    <button class="btn-icon danger" onclick={() => deleteKey(k.id)} title="Révoquer">
                        <Icon name="trash-2" size={18} />
                    </button>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else if !loading}
        <div class="empty-state">
            <Icon name="key" size={48} />
            <p>Aucune clé API active.</p>
        </div>
      {/if}
    </section>
  </div>
</main>

<style>
  /* --- THEME & VARIABLES (Identique AdminDatabase) --- */
  .admin-main {
    /* LIGHT MODE */
    --adm-bg: #f8fafc;
    --adm-text: #1e293b;
    --adm-text-muted: #64748b;
    --adm-border: #e2e8f0;
    --adm-accent: #3b82f6;

    /* Variables Glassmorphism Light */
    --adm-glass-bg: rgba(255, 255, 255, 0.7);
    --adm-glass-border: rgba(255, 255, 255, 0.6);
    --adm-item-bg: rgba(255, 255, 255, 0.5);
    --adm-item-hover: rgba(255, 255, 255, 0.8);

    position: relative;
    min-height: 100vh;
    color: var(--adm-text);
    background-color: var(--adm-bg);
    overflow-x: hidden;
    padding: 2rem 1rem 6rem;
    font-family: system-ui, -apple-system, sans-serif;
    border-radius: 1.5rem;
  }

  :global([data-theme='dark']) .admin-main {
        /* DARK MODE */
        --adm-bg: #020617;
        --adm-text: #f8fafc;
        --adm-text-muted: #94a3b8;
        --adm-border: rgba(255, 255, 255, 0.08);

        /* Variables Glassmorphism Dark */
        --adm-glass-bg: rgba(15, 23, 42, 0.6);
        --adm-glass-border: rgba(255, 255, 255, 0.08);
        --adm-item-bg: rgba(255, 255, 255, 0.03);
        --adm-item-hover: rgba(255, 255, 255, 0.08);
  }

  /* --- BACKGROUND ANIMÉ --- */
  /* Removed */

  .admin-container {
    position: relative; z-index: 1;
    max-width: 1000px; margin: 0 auto;
  }

  /* --- HEADER --- */
  .page-header {
    display: flex; align-items: center; gap: 1.5rem;
    margin-bottom: 3rem;
  }
  .header-icon {
    width: 56px; height: 56px;
    background: linear-gradient(135deg, var(--adm-accent), #8b5cf6);
    color: white; border-radius: 16px;
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 8px 20px -4px rgba(59, 130, 246, 0.5);
  }
  .page-header h1 { font-size: 2rem; font-weight: 800; margin: 0; line-height: 1.1; letter-spacing: -0.02em; }
  .subtitle { color: var(--adm-text-muted); font-size: 1rem; margin: 0.25rem 0 0; }

  .btn-glass {
    display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.6rem 1rem;
    background: var(--adm-item-bg); border: 1px solid var(--adm-glass-border);
    border-radius: 10px; color: var(--adm-text); text-decoration: none; font-weight: 500;
    transition: all 0.2s; cursor: pointer; backdrop-filter: blur(4px);
  }
  .btn-glass:hover { transform: translateY(-2px); background: var(--adm-item-hover); border-color: var(--adm-accent); color: var(--adm-accent); }

  /* --- CARDS --- */
  .glass-card {
    background: var(--adm-glass-bg);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid var(--adm-glass-border);
    border-radius: 20px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.05);
    overflow: hidden;
    margin-bottom: 2rem;
  }

  .card-header {
    padding: 1.25rem 1.5rem;
    border-bottom: 1px solid var(--adm-border);
    display: flex; justify-content: space-between; align-items: center;
    background: rgba(255,255,255,0.02);
  }
  .card-header h3 { margin: 0; font-size: 1.1rem; font-weight: 700; display: flex; align-items: center; gap: 0.75rem; color: var(--adm-text); }
  .card-body { padding: 1.5rem; }

  /* --- FORM --- */
  .form-row {
    display: flex; gap: 1rem; align-items: flex-end; flex-wrap: wrap;
  }
  .input-group { display: flex; flex-direction: column; gap: 0.5rem; }
  .input-group label { font-size: 0.85rem; font-weight: 600; color: var(--adm-text-muted); margin-left: 2px; }
  .input-group.flex-1 { flex: 1; min-width: 200px; }

  .input-glass {
    padding: 0.75rem 1rem;
    background: var(--adm-item-bg);
    border: 1px solid var(--adm-border);
    border-radius: 12px;
    font-size: 0.95rem; color: var(--adm-text);
    transition: all 0.2s;
  }
  .input-glass:focus {
    outline: none; border-color: var(--adm-accent);
    background: var(--adm-item-hover);
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
  }

  .button-group { padding-bottom: 1px; }

  .btn-primary {
    padding: 0.75rem 1.5rem;
    background: var(--adm-accent); color: white;
    border: none; border-radius: 12px;
    font-weight: 600; cursor: pointer;
    display: flex; align-items: center; gap: 0.5rem;
    transition: all 0.2s;
    box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
  }
  .btn-primary:hover:not(:disabled) { background: #2563eb; transform: translateY(-2px); }
  .btn-primary:disabled { opacity: 0.6; cursor: not-allowed; box-shadow: none; }

  .hint-text {
    margin-top: 1rem; font-size: 0.85rem; color: var(--adm-text-muted);
    display: flex; align-items: center; gap: 0.5rem;
  }

  /* --- TABLE --- */
  .table-container { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; min-width: 700px; }

  th {
    text-align: left; padding: 1rem 1.5rem;
    font-size: 0.8rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;
    color: var(--adm-text-muted);
    border-bottom: 1px solid var(--adm-border);
    background: rgba(0,0,0,0.02);
  }

  td {
    padding: 1rem 1.5rem;
    border-bottom: 1px solid var(--adm-border);
    font-size: 0.95rem; vertical-align: middle;
    color: var(--adm-text);
  }

  tr:last-child td { border-bottom: none; }
  tr:hover td { background: var(--adm-item-hover); }

  .id-cell { font-family: monospace; color: var(--adm-text-muted); font-size: 0.85rem; }
  .text-right { text-align: right; }
  .text-muted { color: var(--adm-text-muted); }
  .text-main { color: var(--adm-text); }
  .text-sm { font-size: 0.85rem; }
  .font-medium { font-weight: 500; }

  .scopes-list { display: flex; flex-wrap: wrap; gap: 0.25rem; }

  .badge {
    display: inline-block; padding: 0.2rem 0.6rem;
    border-radius: 6px; font-size: 0.75rem; font-weight: 700;
    font-family: monospace;
  }
  .badge.scope { background: rgba(59, 130, 246, 0.15); color: var(--adm-accent); border: 1px solid rgba(59, 130, 246, 0.2); }
  .badge.all { background: rgba(34, 197, 94, 0.15); color: #22c55e; border: 1px solid rgba(34, 197, 94, 0.2); }

  .btn-refresh {
    background: transparent; border: none; color: var(--adm-text-muted);
    cursor: pointer; padding: 0.5rem; border-radius: 8px; transition: all 0.2s;
  }
  .btn-refresh:hover { background: var(--adm-item-hover); color: var(--adm-accent); }
  .animate-spin { animation: spin 1s linear infinite; }
  @keyframes spin { 100% { transform: rotate(360deg); } }

  .btn-icon.danger {
    background: rgba(239, 68, 68, 0.1); color: #ef4444;
    width: 36px; height: 36px; border-radius: 10px; border: none;
    display: inline-flex; align-items: center; justify-content: center;
    cursor: pointer; transition: all 0.2s;
  }
  .btn-icon.danger:hover { background: #ef4444; color: white; transform: translateY(-2px); }

  .empty-state {
    padding: 4rem 2rem; text-align: center; color: var(--adm-text-muted);
    display: flex; flex-direction: column; align-items: center; gap: 1rem;
    opacity: 0.7;
  }

  @media (max-width: 640px) {
    .page-header { flex-direction: column; align-items: flex-start; gap: 1rem; }
    .header-icon { display: none; }
    .page-header h1 { font-size: 1.5rem; }
    .form-row { flex-direction: column; align-items: stretch; }
    .button-group { align-self: stretch; }
    .btn-primary { justify-content: center; }
  }
</style>
