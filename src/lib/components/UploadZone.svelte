<script lang="ts">
  import Icon from './Icon.svelte';
  import Spinner from './Spinner.svelte';

  interface Props {
    onUpload: (files: File[], onProgress?: (current: number, total: number) => void) => Promise<void>;
    accept?: string;
    multiple?: boolean;
    disabled?: boolean;
  }

  let {
    onUpload,
    accept = 'image/*,video/*',
    multiple = true,
    disabled = false
  }: Props = $props();

  console.log('✓ [UploadZone] Composant chargé');

  let isDragging = $state(false);
  let isUploading = $state(false);
  let uploadProgress = $state(0);
  let uploadTotal = $state(0);
  let fileInputRef: HTMLInputElement;

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
      isDragging = false;

      if (disabled || isUploading) return;

      const items = e.dataTransfer?.items;
      if (!items) return;

      const files: File[] = [];
      const promises: Promise<void>[] = [];

      // Collecter les promises de traitement
      for (let i = 0; i < items.length; i++) {
        const item = items[i];

        if (item.kind === 'file') {
          const entry = items[i].webkitGetAsEntry();
          if (entry) {
            promises.push(processEntry(entry as unknown as FileSystemEntry, files));
          }
        }
      }

      // Attendre que tous les entries soient traités
      if (promises.length > 0) {
        await Promise.all(promises);
      }

      // Nettoyer le dataTransfer ASAP pour éviter les problèmes de clonage
      if (e.dataTransfer) {
        e.dataTransfer.clearData();
      }

      if (files.length > 0) {
        await uploadFiles(files);
      }
    } catch (err: unknown) {
      console.error('Error in handleDrop:', err);
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
          // Vérifier que c'est une image ou vidéo
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

    // Reset input pour permettre de sélectionner les mêmes fichiers à nouveau
    input.value = '';
  }

  async function uploadFiles(files: File[]) {
    isUploading = true;
    uploadProgress = 0;
    uploadTotal = files.length;

    try {
      const onProgressCallback = (current: number, total: number) => {
        uploadProgress = current;
        uploadTotal = total;
      };

      await onUpload(files, onProgressCallback);
    } catch (e: unknown) {
      console.error('Upload error:', e);
      alert('Erreur lors de l\'upload: ' + (e as Error).message);
    } finally {
      isUploading = false;
      uploadProgress = 0;
      uploadTotal = 0;
    }
  }

  function openFileSelector() {
    if (!disabled && !isUploading) {
      fileInputRef?.click();
    }
  }
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
    {#if isUploading}
      <Spinner size={48} />
      <p class="upload-text">Upload en cours...</p>
      {#if uploadTotal > 0}
        <p class="upload-progress">{uploadProgress} / {uploadTotal} fichiers</p>
      {/if}
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
    border: 2px dashed rgba(255, 255, 255, 0.3);
    border-radius: 12px;
    padding: 3rem 2rem;
    text-align: center;
    cursor: pointer;
    transition: all 0.3s ease;
    background: rgba(255, 255, 255, 0.02);
    min-height: 200px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .upload-zone:hover:not(.disabled):not(.uploading) {
    border-color: rgba(59, 130, 246, 0.6);
    background: rgba(59, 130, 246, 0.05);
  }

  .upload-zone.dragging {
    border-color: rgba(59, 130, 246, 0.8);
    background: rgba(59, 130, 246, 0.1);
    transform: scale(1.02);
  }

  .upload-zone.uploading {
    cursor: not-allowed;
    border-color: rgba(34, 197, 94, 0.6);
    background: rgba(34, 197, 94, 0.05);
  }

  .upload-zone.disabled {
    cursor: not-allowed;
    opacity: 0.5;
    border-color: rgba(255, 255, 255, 0.1);
  }

  .upload-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
  }

  .upload-icon {
    color: rgba(255, 255, 255, 0.6);
    transition: color 0.3s ease;
  }

  .upload-zone:hover:not(.disabled):not(.uploading) .upload-icon {
    color: rgba(59, 130, 246, 0.8);
  }

  .upload-zone.dragging .upload-icon {
    color: rgba(59, 130, 246, 1);
  }

  .upload-text {
    font-size: 1.125rem;
    font-weight: 500;
    color: var(--text-primary, #ffffff);
    margin: 0;
  }

  .upload-subtext {
    font-size: 0.9375rem;
    color: var(--text-secondary, #a0a0a0);
    margin: 0;
  }

  .upload-hint {
    font-size: 0.875rem;
    color: var(--text-tertiary, #808080);
    margin: 0;
  }

  .upload-progress {
    font-size: 0.9375rem;
    color: var(--text-secondary, #a0a0a0);
    margin: 0;
  }
</style>
