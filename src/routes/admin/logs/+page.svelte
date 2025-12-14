<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import { fade } from 'svelte/transition';

  let logs = $state<any[]>([]);
  let loading = $state(true);
  let filter = $state('');
  let offset = $state(0);
  const limit = 50;

  async function loadLogs() {
    loading = true;
    const url = new URL(`/api/admin/logs`, location.origin);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('offset', String(offset));
    if (filter) url.searchParams.set('type', filter);
    const res = await fetch(url.toString());
    if (res.ok) {
      const data = await res.json();
      logs = data.logs || [];
    } else {
      logs = [];
    }
    loading = false;
  }

  onMount(() => { void loadLogs(); });

  function nextPage() { offset += limit; void loadLogs(); }
  function prevPage() { offset = Math.max(0, offset - limit); void loadLogs(); }
</script>

<svelte:head>
  <title>Admin — Logs</title>
</svelte:head>

<main class="admin-logs">
  <header class="page-header">
    <div class="header-content">
      <h1>Logs</h1>
      <p class="subtitle">Audit — créations, modifications, suppressions et connexions</p>
    </div>
    <div class="header-actions">
      <input placeholder="Filtrer par type (create, update, delete, login)" bind:value={filter} class="search-input" />
      <button class="btn" onclick={() => { offset = 0; void loadLogs(); }}>Filtrer</button>
    </div>
  </header>

  {#if loading}
    <div class="state-message"><Icon name="loader" size={20} /> Chargement...</div>
  {:else}
    {#if logs.length === 0}
      <div class="empty-state">Aucun log trouvé</div>
    {:else}
      <table class="logs-table" in:fade>
        <thead>
          <tr>
            <th>Date</th>
            <th>Acteur</th>
            <th>Type</th>
            <th>Cible</th>
            <th>Détails</th>
            <th>IP</th>
          </tr>
        </thead>
        <tbody>
          {#each logs as l}
            <tr>
              <td>{l.timestamp}</td>
              <td>{l.actor || '-'}</td>
              <td>{l.event_type}</td>
              <td>{l.target_type}{l.target_id ? ` / ${l.target_id}` : ''}</td>
              <td>{l.details ? l.details : '-'}</td>
              <td>{l.ip || '-'}</td>
            </tr>
          {/each}
        </tbody>
      </table>

      <div class="pagination">
        <button class="btn" onclick={prevPage} disabled={offset === 0}>Précédent</button>
        <button class="btn" onclick={nextPage}>Suivant</button>
      </div>
    {/if}
  {/if}
</main>

<style>
  .admin-logs { padding: 1.5rem; }
  .page-header { display:flex; align-items:center; justify-content:space-between; gap:1rem; }
  .search-input { padding:0.4rem 0.6rem; border-radius:8px; border:1px solid var(--border); }
  .logs-table { width:100%; border-collapse:collapse; margin-top:1rem; }
  .logs-table th, .logs-table td { padding:0.5rem 0.75rem; border-bottom:1px solid var(--border); text-align:left; font-size:0.9rem; }
  .pagination { display:flex; gap:0.5rem; margin-top:1rem; }
</style>
