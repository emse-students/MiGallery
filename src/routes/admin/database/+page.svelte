<script lang="ts">
  import { page } from '$app/state';
  import type { PageData } from './$types';
  
  const data = (page as any).data as PageData;
  const stats = data.stats;
  const backups = data.backups || [];
  
  let uploadFile = $state<File | null>(null);
  let importing = $state(false);
  let exporting = $state(false);
  let backing = $state(false);
  let inspecting = $state(false);
  let message = $state('');
  let messageType: 'success' | 'error' | 'info' = $state('info');
  
  function handleFileSelect(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      uploadFile = input.files[0];
    }
  }
  
  async function exportDatabase() {
    exporting = true;
    message = '';
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
      
      message = '✅ Base de données exportée avec succès';
      messageType = 'success';
    } catch (error) {
      message = `❌ Erreur lors de l'export: ${error}`;
      messageType = 'error';
    } finally {
      exporting = false;
    }
  }
  
  async function importDatabase() {
    if (!uploadFile) {
      message = '⚠️ Veuillez sélectionner un fichier';
      messageType = 'error';
      return;
    }
    
    if (!confirm('⚠️ ATTENTION : Cette action va remplacer la base de données actuelle. Voulez-vous continuer ?')) {
      return;
    }
    
    importing = true;
    message = '';
    
    try {
      const formData = new FormData();
      formData.append('file', uploadFile);
      
      const response = await fetch('/api/admin/db-import', {
        method: 'POST',
        body: formData
      });
      
      const result = await response.json();
      
      if (!response.ok) throw new Error(result.error || 'Échec de l\'import');
      
      message = '✅ Base de données importée avec succès. Rechargement de la page...';
      messageType = 'success';
      
      setTimeout(() => {
        window.location.reload();
      }, 2000);
      
    } catch (error) {
      message = `❌ Erreur lors de l'import: ${error}`;
      messageType = 'error';
    } finally {
      importing = false;
    }
  }
  
  async function createBackup() {
    backing = true;
    message = '';
    
    try {
      const response = await fetch('/api/admin/db-backup', { method: 'POST' });
      const result = await response.json();
      
      if (!response.ok) throw new Error(result.error || 'Échec de la sauvegarde');
      
      message = `✅ ${result.message}`;
      messageType = 'success';
      
      // Recharger la liste des sauvegardes
      setTimeout(() => window.location.reload(), 1500);
      
    } catch (error) {
      message = `❌ Erreur lors de la sauvegarde: ${error}`;
      messageType = 'error';
    } finally {
      backing = false;
    }
  }
  
  async function inspectDatabase() {
    inspecting = true;
    message = '';
    
    try {
      const response = await fetch('/api/admin/db-inspect');
      const result = await response.json();
      
      if (result.hasErrors) {
        message = `⚠️ Erreurs détectées: ${result.errors.join(', ')}`;
        messageType = 'error';
      } else {
        message = '✅ Base de données saine, aucune erreur détectée';
        messageType = 'success';
      }
      
    } catch (error) {
      message = `❌ Erreur lors de l'inspection: ${error}`;
      messageType = 'error';
    } finally {
      inspecting = false;
    }
  }
  
  async function restoreBackup(filename: string) {
    if (!confirm(`⚠️ Restaurer la sauvegarde "${filename}" ? Cela va remplacer la base actuelle.`)) {
      return;
    }
    
    try {
      const response = await fetch('/api/admin/db-restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename })
      });
      
      const result = await response.json();
      
      if (!response.ok) throw new Error(result.error || 'Échec de la restauration');
      
      message = '✅ Sauvegarde restaurée avec succès. Rechargement...';
      messageType = 'success';
      
      setTimeout(() => window.location.reload(), 2000);
      
    } catch (error) {
      message = `❌ Erreur lors de la restauration: ${error}`;
      messageType = 'error';
    }
  }
</script>

<svelte:head>
  <title>Admin — Gestion de la base de données</title>
</svelte:head>

<main>
  <div class="header">
    <h1>Gestion de la base de données</h1>
    <a href="/admin" class="back-link">← Retour à l'admin</a>
  </div>
  
  {#if message}
    <div class="message {messageType}">
      {message}
    </div>
  {/if}
  
  <!-- Statistiques -->
  <section class="card">
    <h2>📊 Statistiques</h2>
    <div class="stats-grid">
      <div class="stat">
        <div class="stat-label">Utilisateurs</div>
        <div class="stat-value">{stats.users}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Albums</div>
        <div class="stat-value">{stats.albums}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Administrateurs</div>
        <div class="stat-value">{stats.admins}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Taille de la DB</div>
        <div class="stat-value">{stats.size}</div>
      </div>
    </div>
  </section>
  
  <!-- Actions rapides -->
  <section class="card">
    <h2>⚡ Actions rapides</h2>
    <div class="actions-grid">
      <button class="btn btn-primary" onclick={exportDatabase} disabled={exporting}>
        {exporting ? '📥 Export en cours...' : '📥 Exporter la DB'}
      </button>
      
      <button class="btn btn-success" onclick={createBackup} disabled={backing}>
        {backing ? '💾 Sauvegarde...' : '💾 Sauvegarder maintenant'}
      </button>
      
      <button class="btn btn-info" onclick={inspectDatabase} disabled={inspecting}>
        {inspecting ? '🔍 Inspection...' : '🔍 Inspecter la DB'}
      </button>
    </div>
  </section>
  
  <!-- Import -->
  <section class="card">
    <h2>📤 Importer une base de données</h2>
    <div class="import-section">
      <div class="warning">
        ⚠️ <strong>Attention :</strong> L'import va remplacer complètement la base de données actuelle. 
        Assurez-vous d'avoir créé une sauvegarde avant !
      </div>
      
      <div class="file-input">
        <input 
          type="file" 
          accept=".db"
          onchange={handleFileSelect}
          disabled={importing}
        />
        {#if uploadFile}
          <p class="file-selected">Fichier sélectionné : {uploadFile.name}</p>
        {/if}
      </div>
      
      <button 
        class="btn btn-danger" 
        onclick={importDatabase} 
        disabled={importing || !uploadFile}
      >
        {importing ? '📤 Import en cours...' : '📤 Importer la DB'}
      </button>
    </div>
  </section>
  
  <!-- Sauvegardes -->
  <section class="card">
    <h2>💾 Sauvegardes disponibles ({backups.length}/10)</h2>
    
    {#if backups.length === 0}
      <p class="no-backups">Aucune sauvegarde disponible. Créez-en une avec le bouton ci-dessus.</p>
    {:else}
      <div class="backups-list">
        {#each backups as backup}
          <div class="backup-item">
            <div class="backup-info">
              <div class="backup-name">📁 {backup.filename}</div>
              <div class="backup-meta">
                <span>📅 {backup.date}</span>
                <span>📏 {backup.size}</span>
              </div>
            </div>
            <button 
              class="btn btn-sm btn-secondary" 
              onclick={() => restoreBackup(backup.filename)}
            >
              🔄 Restaurer
            </button>
          </div>
        {/each}
      </div>
    {/if}
  </section>
  
  <!-- Aide -->
  <section class="card help">
    <h2>💡 Aide</h2>
    <ul>
      <li><strong>Exporter :</strong> Télécharge une copie de la base de données actuelle</li>
      <li><strong>Importer :</strong> Remplace la base de données par un fichier .db</li>
      <li><strong>Sauvegarder :</strong> Crée une sauvegarde horodatée (max 10 conservées)</li>
      <li><strong>Inspecter :</strong> Vérifie l'intégrité de la base de données</li>
      <li><strong>Restaurer :</strong> Remplace la DB actuelle par une sauvegarde</li>
    </ul>
    
    <p>
      <strong>📚 Pour plus d'informations :</strong> 
      Consultez la documentation dans <code>scripts/README.md</code>
    </p>
  </section>
</main>

<style>
  main {
    max-width: 1200px;
    margin: 0 auto;
    padding: 2rem;
  }
  
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 2rem;
  }
  
  .header h1 {
    font-size: 2rem;
    font-weight: 700;
    margin: 0;
  }
  
  .back-link {
    color: var(--accent);
    text-decoration: none;
    font-weight: 500;
  }
  
  .back-link:hover {
    text-decoration: underline;
  }
  
  .message {
    padding: 1rem;
    border-radius: var(--radius-sm);
    margin-bottom: 1.5rem;
    font-weight: 500;
  }
  
  .message.success {
    background: #d4edda;
    color: #155724;
    border: 1px solid #c3e6cb;
  }
  
  .message.error {
    background: #f8d7da;
    color: #721c24;
    border: 1px solid #f5c6cb;
  }
  
  .message.info {
    background: #d1ecf1;
    color: #0c5460;
    border: 1px solid #bee5eb;
  }
  
  .card {
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 1.5rem;
    margin-bottom: 1.5rem;
  }
  
  .card h2 {
    margin-top: 0;
    margin-bottom: 1.5rem;
    font-size: 1.25rem;
    font-weight: 700;
  }
  
  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 1rem;
  }
  
  .stat {
    background: var(--bg-tertiary);
    padding: 1rem;
    border-radius: var(--radius-sm);
    text-align: center;
  }
  
  .stat-label {
    font-size: 0.875rem;
    color: var(--text-muted);
    margin-bottom: 0.5rem;
  }
  
  .stat-value {
    font-size: 2rem;
    font-weight: 700;
    color: var(--accent);
  }
  
  .actions-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 1rem;
  }
  
  .btn {
    padding: 0.75rem 1.5rem;
    border: none;
    border-radius: var(--radius-sm);
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s var(--ease);
    font-size: 1rem;
  }
  
  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  .btn-primary {
    background: var(--accent);
    color: white;
  }
  
  .btn-primary:hover:not(:disabled) {
    opacity: 0.9;
  }
  
  .btn-success {
    background: #28a745;
    color: white;
  }
  
  .btn-info {
    background: #17a2b8;
    color: white;
  }
  
  .btn-danger {
    background: #dc3545;
    color: white;
  }
  
  .btn-secondary {
    background: var(--bg-tertiary);
    color: var(--text-primary);
    border: 1px solid var(--border);
  }
  
  .btn-sm {
    padding: 0.5rem 1rem;
    font-size: 0.875rem;
  }
  
  .import-section {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  
  .warning {
    background: #fff3cd;
    color: #856404;
    padding: 1rem;
    border-radius: var(--radius-sm);
    border: 1px solid #ffeaa7;
  }
  
  .file-input input[type="file"] {
    width: 100%;
    padding: 0.75rem;
    border: 2px dashed var(--border);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  
  .file-selected {
    color: var(--text-secondary);
    font-size: 0.875rem;
    margin-top: 0.5rem;
  }
  
  .no-backups {
    color: var(--text-muted);
    font-style: italic;
  }
  
  .backups-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  
  .backup-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem;
    background: var(--bg-tertiary);
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
  }
  
  .backup-info {
    flex: 1;
  }
  
  .backup-name {
    font-weight: 600;
    margin-bottom: 0.25rem;
  }
  
  .backup-meta {
    display: flex;
    gap: 1rem;
    font-size: 0.875rem;
    color: var(--text-muted);
  }
  
  .help ul {
    margin: 0;
    padding-left: 1.5rem;
  }
  
  .help li {
    margin-bottom: 0.5rem;
    line-height: 1.6;
  }
  
  .help p {
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid var(--border);
  }
  
  .help code {
    background: var(--bg-primary);
    padding: 0.2rem 0.4rem;
    border-radius: 4px;
    font-size: 0.875em;
  }
</style>
