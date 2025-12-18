<script lang="ts">
  import Icon from '$lib/components/Icon.svelte';
  import BackgroundBlobs from '$lib/components/BackgroundBlobs.svelte';
  import { page } from '$app/state';
  import type { PageData } from './$types';
  import { asApiResponse } from '$lib/ts-utils';
  import { showConfirm } from '$lib/confirm';
  import { toast } from '$lib/toast';

  let isAdmin = $derived(page.data.session?.user?.role === 'admin');
  const data = page.data as PageData;
  const stats = data.stats;
  const backups = data.backups || [];

  let uploadFile = $state<File | null>(null);
  let importing = $state(false);
  let exporting = $state(false);
  let backing = $state(false);
  let inspecting = $state(false);
  let repairing = $state(false);
  let databaseStatus = $state<any>(null);
  let showRepairModal = $state(false);

    let persistentMessage = $state('');
    let persistentMessageType: 'success' | 'error' | 'info' = 'info';

  function handleFileSelect(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      uploadFile = input.files[0];
    }
  }

  async function exportDatabase() {
    exporting = true;
    try {
      const response = await fetch('/api/admin/db-export');
      if (!response.ok) throw new Error('Échec de l\'export');

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `migallery_export_${new Date().toISOString().split('T')[0]}.db`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      toast.success('Base de données exportée avec succès');
    } catch (error: unknown) {
      toast.error(`Erreur lors de l'export: ${error}`);
    } finally {
      exporting = false;
    }
  }

  async function importDatabase() {
    if (!uploadFile) {
      toast.error('Veuillez sélectionner un fichier');
      return;
    }

    const ok = await showConfirm('⚠️ ATTENTION : Cette action va remplacer la base de données actuelle. Voulez-vous continuer ?', 'Importer la DB');
    if (!ok) return;

    importing = true;
    try {
      const formData = new FormData();
      formData.append('file', uploadFile);

      const response = await fetch('/api/admin/db-import', {
        method: 'POST',
        body: formData
      });

      const jsonData = await response.json();
      const result = asApiResponse(jsonData);

      if (!response.ok) throw new Error(result.error || 'Échec de l\'import');

      toast.success('Base de données importée. Rechargement...');
      setTimeout(() => window.location.reload(), 2000);

    } catch (error: unknown) {
      toast.error(`Erreur lors de l'import: ${error}`);
    } finally {
      importing = false;
    }
  }

  async function createBackup() {
    backing = true;
    try {
      const response = await fetch('/api/admin/db-backup', { method: 'POST' });
      const jsonData = await response.json();
      const result = asApiResponse(jsonData);

      if (!response.ok) throw new Error(result.error || 'Échec de la sauvegarde');

      toast.success(result.message || 'Sauvegarde créée');
      setTimeout(() => window.location.reload(), 1500);

    } catch (error: unknown) {
      toast.error(`Erreur lors de la sauvegarde: ${error}`);
    } finally {
      backing = false;
    }
  }

  async function inspectDatabase() {
    inspecting = true;
    persistentMessage = '';
    try {
      const response = await fetch('/admin/api/database');
      const result = await response.json();

      if (result.success) {
        databaseStatus = result;
        if (result.status === 'healthy') {
          toast.success('Base de données saine');
        } else {
          toast.error(`Base de données incomplète (${result.missingTables?.length || 0} tables manquantes)`);
        }
      } else {
        toast.error(`Erreur d'inspection: ${result.error}`);
      }
    } catch (error: unknown) {
      toast.error(`Erreur d'inspection: ${error}`);
    } finally {
      inspecting = false;
    }
  }

  async function repairDatabase() {
    repairing = true;
    showRepairModal = false;
    try {
      const response = await fetch('/admin/api/database', { method: 'POST' });
      const result = await response.json();

      if (result.success) {
        toast.success('Base de données réparée avec succès !');
        databaseStatus = result.newStatus;
        setTimeout(() => inspectDatabase(), 1000);
      } else {
        toast.error(`Erreur réparation: ${result.error}`);
      }
    } catch (error: unknown) {
      toast.error(`Erreur: ${error}`);
    } finally {
      repairing = false;
    }
  }

  async function restoreBackup(filename: string) {
    const ok = await showConfirm(`⚠️ Restaurer "${filename}" ? Cela remplacera la base actuelle.`, 'Restaurer');
    if (!ok) return;

    try {
      const response = await fetch('/api/admin/db-restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename })
      });

      const jsonData = await response.json();
      const result = asApiResponse(jsonData);

      if (!response.ok) throw new Error(result.error || 'Échec de la restauration');

      toast.success('Sauvegarde restaurée. Rechargement...');
      setTimeout(() => window.location.reload(), 2000);

    } catch (error: unknown) {
      toast.error(`Erreur restauration: ${error}`);
    }
  }
</script>

<svelte:head>
  <title>Admin — Base de données</title>
</svelte:head>

<main class="admin-main">
  <!-- Fond animé -->
  <BackgroundBlobs />

  <div class="admin-container">

    <!-- En-tête -->
    <header class="page-header">
      <div class="header-icon">
        <Icon name="database" size={32} />
      </div>
      <div>
        <h1>Maintenance BDD</h1>
        <p class="subtitle">Sauvegardes, restaurations et intégrité du système</p>
      </div>
    </header>

    {#if persistentMessage}
        <div class="glass-card mb-6 border-l-4" class:border-red-500={(persistentMessageType as any) === 'error'} class:border-green-500={(persistentMessageType as any) !== 'error'}>
            {persistentMessage}
        </div>
    {/if}

    <div class="dashboard-grid">

        <!-- Colonne Gauche : Stats & Actions -->
        <div class="left-col">

            <!-- Statistiques -->
            <section class="glass-card">
                <h2 class="section-title"><Icon name="bar-chart-2" size={20} /> Statistiques</h2>
                <div class="stats-grid">
                    <div class="stat-item">
                        <span class="stat-label">Utilisateurs</span>
                        <span class="stat-value">{stats.users}</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Albums</span>
                        <span class="stat-value">{stats.albums}</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Admins</span>
                        <span class="stat-value">{stats.admins}</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Taille</span>
                        <span class="stat-value highlight">{stats.size}</span>
                    </div>
                </div>
            </section>

            <!-- Actions Rapides -->
            <section class="glass-card">
                <h2 class="section-title"><Icon name="zap" size={20} /> Actions rapides</h2>
                <div class="actions-list">
                    <button class="action-btn primary" onclick={createBackup} disabled={backing}>
                        <div class="btn-icon-wrapper"><Icon name="save" size={24} /></div>
                        <div class="btn-content">
                            <span class="btn-title">Sauvegarde</span>
                            <span class="btn-desc">{backing ? 'En cours...' : 'Créer un snapshot'}</span>
                        </div>
                    </button>

                    <button class="action-btn secondary" onclick={exportDatabase} disabled={exporting}>
                        <div class="btn-icon-wrapper"><Icon name="download" size={24} /></div>
                        <div class="btn-content">
                            <span class="btn-title">Export SQL</span>
                            <span class="btn-desc">{exporting ? 'En cours...' : 'Télécharger .db'}</span>
                        </div>
                    </button>

                    <button class="action-btn info" onclick={inspectDatabase} disabled={inspecting}>
                        <div class="btn-icon-wrapper"><Icon name="activity" size={24} /></div>
                        <div class="btn-content">
                            <span class="btn-title">Inspection</span>
                            <span class="btn-desc">{inspecting ? 'Analyse...' : 'Vérifier intégrité'}</span>
                        </div>
                    </button>

                    {#if databaseStatus && databaseStatus.status !== 'healthy'}
                        <button class="action-btn warning" onclick={() => (showRepairModal = true)} disabled={repairing}>
                            <div class="btn-icon-wrapper"><Icon name="tool" size={24} /></div>
                            <div class="btn-content">
                                <span class="btn-title">Réparer</span>
                                <span class="btn-desc">Tables manquantes</span>
                            </div>
                        </button>
                    {/if}
                </div>
            </section>

            <!-- Import (Danger Zone) -->
            <section class="glass-card danger-zone">
                <h2 class="section-title text-red-500"><Icon name="alert-triangle" size={20} /> Zone de danger</h2>
                <p class="text-sm text-muted mb-4">Importer une base remplacera toutes les données actuelles. Soyez prudent.</p>

                <div class="file-drop-area">
                    <input type="file" id="db_upload" accept=".db" onchange={handleFileSelect} disabled={importing} />
                    <label for="db_upload">
                        <Icon name="upload-cloud" size={32} class="mb-2 text-muted" />
                        <span class="font-medium">{uploadFile ? uploadFile.name : 'Choisir un fichier .db'}</span>
                    </label>
                </div>

                <button class="btn-full-danger mt-4" onclick={importDatabase} disabled={importing || !uploadFile}>
                    {importing ? 'Importation...' : 'Importer et écraser'}
                </button>
            </section>

        </div>

        <!-- Colonne Droite : Status & Backups -->
        <div class="right-col">

            <!-- État détaillé (affiché après inspection) -->
            {#if databaseStatus}
                <section class="glass-card slide-in">
                    <div class="flex items-center justify-between mb-4">
                        <h2 class="section-title m-0">État du système</h2>
                        <span class="status-badge {databaseStatus.status}">
                            {databaseStatus.status === 'healthy' ? 'Sain' : 'Problème'}
                        </span>
                    </div>

                    <div class="tables-grid">
                        {#each databaseStatus.tables || [] as table}
                            <div class="table-check-item {table.exists ? 'valid' : 'invalid'}">
                                <Icon name={table.exists ? 'check-circle' : 'x-circle'} size={16} />
                                <span class="t-name">{table.name}</span>
                                <span class="t-count">{table.rowCount ?? 0}</span>
                            </div>
                        {/each}
                    </div>

                    {#if databaseStatus.missingTables?.length > 0}
                        <div class="mt-4 p-3 bg-red-500/10 rounded-lg border border-red-500/20">
                            <strong class="text-red-500 text-sm block mb-1">Manquant :</strong>
                            <div class="flex flex-wrap gap-2">
                                {#each databaseStatus.missingTables as t}
                                    <span class="text-xs bg-red-500/20 text-red-600 px-2 py-1 rounded">{t}</span>
                                {/each}
                            </div>
                        </div>
                    {/if}
                </section>
            {/if}

            <!-- Liste des sauvegardes -->
            <section class="glass-card backup-card">
                <div class="backup-header">
                    <h2 class="section-title m-0">Sauvegardes ({backups.length})</h2>
                    <Icon name="archive" size={20} class="text-muted" />
                </div>

                <div class="backup-list-container">
                    {#if backups.length === 0}
                        <div class="empty-placeholder">
                            <Icon name="inbox" size={48} />
                            <p>Aucune sauvegarde</p>
                        </div>
                    {:else}
                        {#each backups as backup}
                            <div class="backup-row">
                                <div class="backup-icon">
                                    <Icon name="file-text" size={20} />
                                </div>
                                <div class="backup-details">
                                    <div class="backup-name">{backup.filename}</div>
                                    <div class="backup-meta">
                                        <span>{backup.date}</span> • <span>{backup.size}</span>
                                    </div>
                                </div>
                                <button class="btn-restore" onclick={() => restoreBackup(backup.filename)} title="Restaurer">
                                    <Icon name="rotate-ccw" size={18} />
                                </button>
                            </div>
                        {/each}
                    {/if}
                </div>
            </section>

        </div>
    </div>
  </div>

  <!-- Modal Réparation -->
  {#if showRepairModal}
    <div class="modal-backdrop" onclick={() => (showRepairModal = false)} role="presentation">
        <div
            class="modal-glass"
            onclick={(e) => e.stopPropagation()}
            role="dialog"
            tabindex="0"
            aria-modal="true"
            aria-labelledby="repairDialogTitle"
            onkeydown={(e) => { if (e.key === 'Escape') showRepairModal = false; else e.stopPropagation(); }}
        >
            <div class="modal-icon warning">
                <Icon name="tool" size={32} />
            </div>
            <h3 id="repairDialogTitle">Réparer la structure ?</h3>
            <p>
                Cette opération va recréer les tables manquantes.
                Aucune donnée existante ne sera perdue, mais il est recommandé de faire une sauvegarde avant.
            </p>
            <div class="modal-actions">
                <button class="btn-glass" onclick={() => (showRepairModal = false)}>Annuler</button>
                <button class="btn-glass primary" onclick={repairDatabase} disabled={repairing}>
                    {repairing ? 'Réparation...' : 'Confirmer la réparation'}
                </button>
            </div>
        </div>
    </div>
  {/if}

</main>

<style>
  /* --- THEME & VARIABLES --- */
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

  .admin-container { position: relative; z-index: 1; max-width: 1200px; margin: 0 auto; }

  /* --- HEADER --- */
  .page-header { display: flex; align-items: center; gap: 1.5rem; margin-bottom: 3rem; }
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
  .btn-glass.primary { background: var(--adm-accent); color: white; border-color: transparent; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3); }
  .btn-glass.primary:hover { background: #2563eb; color: white; transform: translateY(-2px); }

  /* --- GRID LAYOUT --- */
  .dashboard-grid {
      display: grid;
      grid-template-columns: 2fr 1.2fr;
      gap: 2.5rem; /* Gap augmenté significativement */
      align-items: start;
  }
  @media (max-width: 900px) { .dashboard-grid { grid-template-columns: 1fr; } }

  .left-col, .right-col {
      display: flex;
      flex-direction: column;
      gap: 2rem; /* Espacement vertical entre les cartes */
  }

  /* --- CARDS --- */
  .glass-card {
    background: var(--adm-glass-bg);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid var(--adm-glass-border);
    border-radius: 20px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.05);
    padding: 2rem; /* Padding interne explicite */
  }

  /* Cas spécifique pour la carte de backup qui a un header custom */
  .backup-card {
      padding: 0;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      height: 100%;
      max-height: 800px;
  }
  .backup-header {
      padding: 1.5rem 2rem;
      border-bottom: 1px solid var(--adm-border);
      display: flex; justify-content: space-between; align-items: center;
      background: rgba(255,255,255,0.02);
  }
  .backup-list-container {
      overflow-y: auto;
      flex: 1;
      padding: 1rem;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
  }

  .section-title {
    font-size: 1.1rem; font-weight: 700; margin-bottom: 1.5rem;
    display: flex; align-items: center; gap: 0.75rem; color: var(--adm-text);
  }
  .section-title.m-0 { margin-bottom: 0; }

  /* --- STATS --- */
  .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1.25rem; }
  @media (max-width: 600px) { .stats-grid { grid-template-columns: repeat(2, 1fr); } }

  .stat-item {
    background: var(--adm-item-bg);
    border: 1px solid var(--adm-border);
    border-radius: 16px; padding: 1.25rem 1rem; text-align: center;
    transition: transform 0.2s;
  }
  .stat-item:hover { transform: translateY(-2px); border-color: var(--adm-glass-border); }
  .stat-label { display: block; font-size: 0.8rem; font-weight: 600; color: var(--adm-text-muted); margin-bottom: 0.5rem; text-transform: uppercase; letter-spacing: 0.05em; }
  .stat-value { font-size: 1.5rem; font-weight: 800; color: var(--adm-text); }
  .stat-value.highlight {
    background: linear-gradient(135deg, var(--adm-accent), #8b5cf6);
    background-clip: text;
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    color: transparent;
  }

  /* --- ACTIONS --- */
  .actions-list { display: grid; grid-template-columns: 1fr; gap: 1.25rem; }
  .action-btn {
    display: flex; align-items: center; gap: 1.25rem; width: 100%;
    padding: 1.25rem; border-radius: 16px; border: 1px solid transparent;
    background: var(--adm-item-bg);
    text-align: left; cursor: pointer; transition: all 0.2s;
  }
  .action-btn:hover:not(:disabled) {
    transform: translateY(-2px);
    background: var(--adm-item-hover);
    border-color: var(--adm-glass-border);
    box-shadow: 0 10px 25px -5px rgba(0,0,0,0.1);
  }
  .action-btn:disabled { opacity: 0.5; cursor: not-allowed; filter: grayscale(1); }

  .btn-icon-wrapper {
    width: 48px; height: 48px; border-radius: 12px;
    display: flex; align-items: center; justify-content: center;
    color: white; flex-shrink: 0;
    box-shadow: 0 4px 10px rgba(0,0,0,0.1);
  }

  .action-btn.primary .btn-icon-wrapper { background: linear-gradient(135deg, #3b82f6, #2563eb); }
  .action-btn.secondary .btn-icon-wrapper { background: linear-gradient(135deg, #10b981, #059669); }
  .action-btn.info .btn-icon-wrapper { background: linear-gradient(135deg, #8b5cf6, #7c3aed); }
  .action-btn.warning .btn-icon-wrapper { background: linear-gradient(135deg, #f59e0b, #d97706); }

  .btn-content { display: flex; flex-direction: column; gap: 0.15rem; }
  .btn-title { font-weight: 700; font-size: 1rem; color: var(--adm-text); }
  .btn-desc { font-size: 0.85rem; color: var(--adm-text-muted); }

  /* --- DANGER ZONE / IMPORT --- */
  .danger-zone {
    border-color: rgba(239, 68, 68, 0.2);
    background: rgba(239, 68, 68, 0.05) !important;
  }
  :global([data-theme='dark']) .danger-zone { background: rgba(239, 68, 68, 0.1) !important; }

  .file-drop-area { position: relative; margin-top: 1rem; }
  .file-drop-area input { position: absolute; inset: 0; opacity: 0; cursor: pointer; z-index: 2; }
  .file-drop-area label {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    padding: 2.5rem; border: 2px dashed var(--adm-border); border-radius: 16px;
    background: var(--adm-item-bg); transition: all 0.2s;
  }
  .file-drop-area input:hover + label { border-color: var(--adm-accent); background: var(--adm-item-hover); }

  .btn-full-danger {
    width: 100%; padding: 1rem; margin-top: 1rem;
    background: linear-gradient(135deg, #ef4444, #dc2626); color: white;
    border: none; border-radius: 10px; font-weight: 600; cursor: pointer;
    transition: transform 0.2s, opacity 0.2s; box-shadow: 0 4px 12px rgba(239, 68, 68, 0.3);
  }
  .btn-full-danger:hover:not(:disabled) { transform: translateY(-2px); opacity: 0.95; }
  .btn-full-danger:disabled { opacity: 0.5; cursor: not-allowed; }

  /* --- STATUS BADGES & TABLES --- */
  .status-badge {
    padding: 0.35rem 0.85rem; border-radius: 99px; font-size: 0.85rem; font-weight: 700;
  }
  .status-badge.healthy { background: rgba(34, 197, 94, 0.2); color: #22c55e; border: 1px solid rgba(34, 197, 94, 0.3); }
  .status-badge.incomplete { background: rgba(234, 179, 8, 0.2); color: #eab308; border: 1px solid rgba(234, 179, 8, 0.3); }

  .tables-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 0.75rem; }
  .table-check-item {
    display: flex; align-items: center; gap: 0.5rem; padding: 0.75rem;
    border-radius: 8px; border: 1px solid var(--adm-border); background: var(--adm-item-bg);
    font-size: 0.85rem;
  }
  .table-check-item.valid { color: #10b981; border-color: rgba(16, 185, 129, 0.2); }
  .table-check-item.invalid { color: #ef4444; border-color: rgba(239, 68, 68, 0.2); }
  .t-name { flex: 1; font-weight: 500; color: var(--adm-text); }
  .t-count { font-family: monospace; color: var(--adm-text-muted); font-size: 0.75rem; }

  /* --- BACKUPS LIST --- */
  .backup-row {
    display: flex; align-items: center; gap: 1rem; padding: 1rem;
    background: var(--adm-item-bg); border-radius: 12px; border: 1px solid transparent;
    transition: all 0.2s;
  }
  .backup-row:hover { background: var(--adm-item-hover); border-color: var(--adm-glass-border); }

  .backup-icon {
    width: 40px; height: 40px; background: rgba(59, 130, 246, 0.1);
    color: var(--adm-accent); border-radius: 10px;
    display: flex; align-items: center; justify-content: center;
  }
  .backup-details { flex: 1; }
  .backup-name { font-weight: 600; font-size: 0.9rem; color: var(--adm-text); }
  .backup-meta { font-size: 0.75rem; color: var(--adm-text-muted); margin-top: 2px; }

  .btn-restore {
    width: 36px; height: 36px; border: none; background: transparent;
    color: var(--adm-text-muted); border-radius: 8px; cursor: pointer;
    display: flex; align-items: center; justify-content: center; transition: all 0.2s;
  }
  .btn-restore:hover { background: rgba(59, 130, 246, 0.15); color: var(--adm-accent); }

  .empty-placeholder {
    padding: 3rem; text-align: center; color: var(--adm-text-muted);
    display: flex; flex-direction: column; align-items: center; gap: 1rem;
    opacity: 0.7;
  }

  /* --- MODAL --- */
  .modal-backdrop {
    position: fixed; inset: 0; background: rgba(0,0,0,0.55); backdrop-filter: blur(8px) saturate(120%);
    z-index: 100; display: flex; align-items: center; justify-content: center;
  }
  .modal-glass {
    background: rgba(255,255,255,0.04); width: 90%; max-width: 520px;
    padding: 1.75rem; border-radius: 18px; border: 1px solid rgba(255,255,255,0.06);
    box-shadow: 0 20px 50px rgba(2,6,23,0.6); text-align: center;
    position: relative; overflow: hidden; backdrop-filter: blur(8px) saturate(120%);
  }
  /* Petit effet de lueur dans la modal */
  .modal-glass::before {
    content: ''; position: absolute; top: 0; left: 0; right: 0; height: 100px;
    background: linear-gradient(to bottom, rgba(255,255,255,0.05), transparent); pointer-events: none;
  }

  .modal-icon.warning {
    width: 64px; height: 64px; background: rgba(245, 158, 11, 0.1); color: #f59e0b;
    border-radius: 20px; display: flex; align-items: center; justify-content: center;
    margin: 0 auto 1.5rem;
  }
  .modal-glass h3 { font-size: 1.5rem; margin-bottom: 0.5rem; color: var(--adm-text); }
  .modal-glass p { color: var(--adm-text-muted); margin-bottom: 2rem; line-height: 1.6; }

  .modal-actions { display: flex; gap: 1rem; justify-content: center; }

  .slide-in { animation: slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1); }
  @keyframes slideIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
</style>
