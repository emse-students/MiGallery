<script lang="ts">
  import Icon from './Icon.svelte';
  import Spinner from './Spinner.svelte';

  interface FileResult {
    file: File;
    isDuplicate: boolean;
    assetId?: string;
  }

  interface Props {
    onUpload: (
      files: File[],
      onProgress?: (current: number, total: number) => void,
      onFileResult?: (result: FileResult) => void
    ) => Promise<Array<{ file: File; isDuplicate: boolean; assetId?: string }>>;
    accept?: string;
    multiple?: boolean;
    disabled?: boolean;
  }

  interface UploadFileStatus {
    file: File;
    status: 'pending' | 'uploading' | 'success' | 'error' | 'duplicate';
    error?: string;
    progress: number;
  }

  let {
    onUpload,
    accept = 'image/*,video/*',
    multiple = true,
    disabled = false
  }: Props = $props();

  let isDragging = $state(false);
  let isUploading = $state(false);
  let fileStatuses = $state<UploadFileStatus[]>([]);
  let fileInputRef: HTMLInputElement;
  let globalProgress = $state(0); // Pourcentage global d'upload
  let uploadedCount = $state(0); // Nombre total de fichiers uploadés avec succès (persistant)
  let duplicateCountPersist = $state(0); // Nombre total de doublons (persistant)
  let errorCountPersist = $state(0); // Nombre total d'erreurs (persistant)

  function handleDragOver(e: DragEvent) {
    try {
      e.preventDefault();
      e.stopPropagation();
      if (!disabled && !isUploading) {
        isDragging = true;
      }
    } catch (err: unknown) {
      console.error('Error in handleDragOver:', err);
    }
  }

  function handleDragLeave(e: DragEvent) {
    try {
      e.preventDefault();
      e.stopPropagation();
      isDragging = false;
    } catch (err: unknown) {
      console.error('Error in handleDragLeave:', err);
    }
  }

  async function handleDrop(e: DragEvent) {
    try {
      e.preventDefault();
      e.stopPropagation();

      const items = e.dataTransfer?.items;
      if (!items) {
        Promise.resolve().then(() => { isDragging = false; });
        return;
      }

      const files: File[] = [];
      const promises: Promise<void>[] = [];

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === 'file') {
          const entry = items[i].webkitGetAsEntry();
          if (entry) {
            promises.push(processEntry(entry as unknown as FileSystemEntry, files));
          }
        }
      }

      Promise.resolve().then(async () => {
        isDragging = false;

        if (disabled || isUploading) return;

        if (promises.length > 0) {
          await Promise.all(promises);
        }

        if (files.length > 0) {
          await uploadFiles(files);
        }
      });
    } catch (err: unknown) {
      console.error('Error in handleDrop:', err);
      Promise.resolve().then(() => { isDragging = false; });
    }
  }

  interface FileSystemEntry {
    isFile: boolean;
    isDirectory: boolean;
    file: (callback: (file: File) => void) => void;
    createReader: () => FileSystemDirectoryReader;
  }

  interface FileSystemDirectoryReader {
    readEntries: (callback: (entries: FileSystemEntry[]) => void) => void;
  }

  async function processEntry(entry: FileSystemEntry, files: File[]): Promise<void> {
    if (entry.isFile) {
      return new Promise((resolve) => {
        entry.file((file: File) => {
          if (file.type.startsWith('image/') || file.type.startsWith('video/')) {
            files.push(file);
          }
          resolve();
        });
      });
    } else if (entry.isDirectory) {
      const dirReader = entry.createReader();
      return new Promise((resolve) => {
        dirReader.readEntries(async (entries: FileSystemEntry[]) => {
          for (const entry of entries) {
            await processEntry(entry, files);
          }
          resolve();
        });
      });
    }
  }

  function handleFileSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    const files = Array.from(input.files || []);

    if (files.length > 0) {
      uploadFiles(files);
    }

    input.value = '';
  }

  async function uploadFiles(files: File[]) {
    isUploading = true;
    fileStatuses = files.map((file) => ({
      file,
      status: 'pending' as const,
      progress: 0
    }));

    try {
      // Upload les fichiers valides
      // onProgress: only update global progress bar; per-file status will be set by onFileResult
      const onProgressCallback = (current: number, total: number) => {
        globalProgress = Math.round((current / total) * 100);
      };

      const onFileResultCallback = (result: FileResult) => {
        const statusIndex = fileStatuses.findIndex((s) => s.file === result.file);
        if (statusIndex >= 0) {
          if (result.isDuplicate) {
            fileStatuses[statusIndex].status = 'duplicate';
            fileStatuses[statusIndex].error = 'Ce fichier a déjà été uploadé';
            duplicateCountPersist = duplicateCountPersist + 1; // Incrémenter le compteur persistant
            // keep visible a bit longer
            setTimeout(() => {
              fileStatuses = fileStatuses.filter((s) => s.file !== result.file);
            }, 3000);
          } else {
            fileStatuses[statusIndex].status = 'success';
            fileStatuses[statusIndex].progress = 100;
            uploadedCount = uploadedCount + 1; // Incrémenter le compteur persistant
            // remove success after short delay
            setTimeout(() => {
              fileStatuses = fileStatuses.filter((s) => s.file !== result.file);
            }, 1000);
          }
          fileStatuses = [...fileStatuses];
        }
      };

      const results = await onUpload(files, onProgressCallback, onFileResultCallback);

      // Vérifier que results est un array
      const uploadResults = Array.isArray(results) ? results : [];

      // Traiter les doublons (les succès sont déjà gérés par le callback)
      for (const result of uploadResults) {
        if (result.isDuplicate) {
          const statusIndex = fileStatuses.findIndex((s) => s.file === result.file);
          if (statusIndex >= 0) {
            fileStatuses[statusIndex].status = 'duplicate';
            fileStatuses[statusIndex].error = 'Ce fichier a déjà été uploadé';
            duplicateCountPersist = duplicateCountPersist + 1; // Incrémenter le compteur persistant

            // Laisser le message visible un peu plus longtemps pour que l'utilisateur le voie
            setTimeout(() => {
              fileStatuses = fileStatuses.filter((s) => s.file !== result.file);
            }, 3000);
          }
        }
      }
    } catch (e: unknown) {
      console.error('Upload error:', e);
      for (let i = 0; i < fileStatuses.length; i++) {
        if (fileStatuses[i].status === 'uploading' || fileStatuses[i].status === 'pending') {
          fileStatuses[i].status = 'error';
          fileStatuses[i].error = (e as Error).message;
          errorCountPersist = errorCountPersist + 1; // Incrémenter le compteur persistant
        }
      }
    } finally {
      isUploading = false;
      globalProgress = 0; // Réinitialiser le pourcentage global

      // Ne ferme le panneau que s'il n'y a pas d'erreurs
      setTimeout(() => {
        const hasErrors = fileStatuses.some((s) => s.status === 'error');
        if (!hasErrors) {
          fileStatuses = [];
        }
      }, 3000);
    }
  }

  function retryUpload(failedFiles: File[]) {
    fileStatuses = fileStatuses.map((s) =>
      failedFiles.includes(s.file) ? { ...s, status: 'pending' as const, error: undefined } : s
    );
    uploadFiles(failedFiles);
  }

  function clearStatuses() {
    fileStatuses = [];
  }

  function openFileSelector() {
    if (!disabled && !isUploading) {
      fileInputRef?.click();
    }
  }

  const successCount = $derived(uploadedCount);
  const visibleErrorCount = $derived(fileStatuses.filter((s) => s.status === 'error').length);
  const visibleDuplicateCount = $derived(fileStatuses.filter((s) => s.status === 'duplicate').length);
  const failedFiles = $derived(fileStatuses.filter((s) => s.status === 'error').map((s) => s.file));
</script>

<div
  class="upload-zone {isDragging ? 'dragging' : ''} {isUploading ? 'uploading' : ''} {disabled ? 'disabled' : ''}"
  ondragover={handleDragOver}
  ondragleave={handleDragLeave}
  ondrop={handleDrop}
  role="button"
  tabindex={disabled ? -1 : 0}
  onclick={openFileSelector}
  onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFileSelector(); } }}
>
  <input
    bind:this={fileInputRef}
    type="file"
    {accept}
    {multiple}
    onchange={handleFileSelect}
    style="display: none;"
    webkitdirectory={false}
  />

  <div class="upload-content">
    {#if fileStatuses.length > 0}
      <div class="upload-summary">
        {#if isUploading}
          <div class="summary-item uploading">
            <Spinner size={24} />
            <span>Upload en cours...</span>
          </div>
          <div class="progress-bar global">
            <div class="progress-fill" style="width: {globalProgress}%"></div>
          </div>
          <p class="progress-text">{globalProgress}%</p>
        {/if}
        {#if successCount > 0}
          <div class="summary-item success">
            <Icon name="check-circle" size={24} />
            <span>{successCount} fichier{successCount > 1 ? 's' : ''} uploadé{successCount > 1 ? 's' : ''}</span>
          </div>
        {/if}
        {#if errorCountPersist > 0}
          <div class="summary-item error">
            <Icon name="x-circle" size={24} />
            <span>{errorCountPersist} erreur{errorCountPersist > 1 ? 's' : ''}</span>
          </div>
        {/if}
        {#if duplicateCountPersist > 0}
          <div class="summary-item duplicate">
            <Icon name="alert-circle" size={24} />
            <span>{duplicateCountPersist} doublon{duplicateCountPersist > 1 ? 's' : ''}</span>
          </div>
        {/if}

        <div class="file-list">
          {#each fileStatuses as item (item.file.name + '-' + item.file.size + '-' + item.file.lastModified)}
            <div class="file-item {item.status}">
              <div class="file-header">
                <div class="file-info">
                  <span class="file-name">{item.file.name}</span>
                  <span class="file-size">({(item.file.size / 1024 / 1024).toFixed(2)} MB)</span>
                </div>
                <div class="file-status">
                  {#if item.status === 'success'}
                    <Icon name="check" size={16} />
                  {:else if item.status === 'error'}
                    <Icon name="x" size={16} />
                  {:else if item.status === 'duplicate'}
                    <Icon name="alert" size={16} />
                  {:else if item.status === 'uploading'}
                    <Spinner size={16} />
                  {/if}
                </div>
              </div>
              {#if item.error}
                <p class="error-message">{item.error}</p>
              {/if}
            </div>
          {/each}
        </div>

        {#if errorCountPersist > 0}
          <button class="btn-retry" onclick={(e) => { e.stopPropagation(); retryUpload(failedFiles); }}>
            <Icon name="refresh-cw" size={16} />
            Réessayer les uploads échoués
          </button>
        {/if}

        {#if !isUploading}
          <button class="btn-clear" onclick={(e) => { e.stopPropagation(); clearStatuses(); }}>
            Fermer
          </button>
        {/if}
      </div>
    {:else}
      <div class="upload-icon">
        <Icon name="upload" size={48} />
      </div>
      <p class="upload-text">
        {#if isDragging}
          Déposez vos fichiers ou dossiers ici
        {:else}
          Glissez-déposez des fichiers ou dossiers ici
        {/if}
      </p>
      <p class="upload-subtext">ou cliquez pour sélectionner</p>
      <p class="upload-hint">Images et vidéos acceptées</p>
    {/if}
  </div>
</div>

<style>
  .upload-zone {
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 2.25rem 1.5rem;
    text-align: center;
    cursor: pointer;
    transition: all 0.22s ease;
    background: var(--bg-secondary);
    backdrop-filter: blur(8px) saturate(120%);
    -webkit-backdrop-filter: blur(8px) saturate(120%);
    min-height: 180px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-primary);
  }

  .upload-zone:hover:not(.disabled):not(.uploading) {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 6%, var(--bg-elevated));
  }

  .upload-zone.dragging {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, var(--bg-elevated));
    transform: scale(1.02);
  }

  .upload-zone.uploading {
    cursor: not-allowed;
    border-color: var(--success);
    background: color-mix(in srgb, var(--success) 6%, var(--bg-secondary));
  }

  .upload-zone.disabled {
    cursor: not-allowed;
    opacity: 0.5;
    border-color: var(--border);
  }

  .upload-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
  }

  .upload-icon {
    color: var(--text-secondary);
    transition: color 0.3s ease;
  }

  .upload-zone:hover:not(.disabled):not(.uploading) .upload-icon {
    color: var(--accent);
    opacity: 0.8;
  }

  .upload-zone.dragging .upload-icon {
    color: var(--accent);
    opacity: 1;
  }

  .upload-text {
    font-size: 1.125rem;
    font-weight: 500;
    color: var(--text-primary);
    margin: 0;
  }

  .upload-subtext {
    font-size: 0.9375rem;
    color: var(--text-secondary);
    margin: 0;
  }

  .upload-hint {
    font-size: 0.875rem;
    color: var(--text-muted);
    margin: 0;
  }

  .upload-summary {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    align-items: center;
  }

  .summary-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    border-radius: 8px;
    font-weight: 500;
  }

  .summary-item.success {
    background: color-mix(in srgb, var(--success) 10%, transparent);
    color: var(--success);
  }

  .summary-item.error {
    background: color-mix(in srgb, var(--error) 10%, transparent);
    color: var(--error);
  }

  .summary-item.duplicate {
    background: color-mix(in srgb, var(--warning) 10%, transparent);
    color: var(--warning);
  }

  .file-list {
    width: 100%;
    max-height: 400px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .file-item {
    padding: 1rem;
    border-radius: 8px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
  }

  .file-item.success {
    border-color: color-mix(in srgb, var(--success) 30%, transparent);
    background: color-mix(in srgb, var(--success) 5%, transparent);
  }

  .file-item.error {
    border-color: color-mix(in srgb, var(--error) 30%, transparent);
    background: color-mix(in srgb, var(--error) 5%, transparent);
  }

  .file-item.duplicate {
    border-color: color-mix(in srgb, var(--warning) 30%, transparent);
    background: color-mix(in srgb, var(--warning) 5%, transparent);
  }

  .file-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.5rem;
  }

  .file-info {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.25rem;
  }

  .file-name {
    font-weight: 500;
    color: var(--text-primary);
    word-break: break-all;
  }

  .file-size {
    font-size: 0.875rem;
    color: var(--text-secondary);
  }

  .file-status {
    display: flex;
    align-items: center;
  }

  .progress-bar {
    width: 100%;
    height: 6px;
    background: var(--bg-quaternary);
    border-radius: 3px;
    overflow: hidden;
    margin-bottom: 0.5rem;
  }

  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--accent), var(--success));
    transition: width 0.3s ease;
  }

  .progress-text {
    font-size: 0.75rem;
    color: var(--text-secondary);
    margin: 0;
  }

  .error-message {
    font-size: 0.875rem;
    color: var(--error);
    margin: 0;
  }

  .btn-retry {
    padding: 0.75rem 1.5rem;
    background: var(--accent);
    color: white;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    font-weight: 500;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    transition: background 0.2s ease;
  }

  .btn-retry:hover {
    background: var(--accent-hover);
  }

  .btn-clear {
    padding: 0.75rem 1.5rem;
    background: var(--bg-tertiary);
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: 8px;
    cursor: pointer;
    font-weight: 500;
    transition: background 0.2s ease;
  }

  .btn-clear:hover {
    background: var(--bg-quaternary);
  }
</style>
