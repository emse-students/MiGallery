<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import Icon from './Icon.svelte';
  import Spinner from './Spinner.svelte';

  interface Props {
    onPhoto: (file: File) => void;
    disabled?: boolean;
  }

  let { onPhoto, disabled = false }: Props = $props();

  let cameraOpen = $state(false);
  let videoElement: HTMLVideoElement | undefined = $state(undefined);
  let canvasElement: HTMLCanvasElement | undefined = $state(undefined);
  let stream: MediaStream | null = null;
  let loading = $state(false);
  let error = $state<string | null>(null);
  let canUseWebcam = $state(false);
  let isMobile = $state(false);

  // Refs pour les inputs
  let fileInputRef: HTMLInputElement | undefined = $state(undefined);
  let cameraInputRef: HTMLInputElement | undefined = $state(undefined);

  onMount(async () => {
    // Détecter si on est sur mobile
    isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

    // Sur PC, vérifier si l'API getUserMedia est disponible
    if (!isMobile && typeof navigator.mediaDevices?.getUserMedia === 'function') {
      // L'API est disponible, on affiche le bouton webcam
      // La détection réelle de la webcam se fera au moment du clic
      canUseWebcam = true;
    }
  });

  onDestroy(() => {
    stopCamera();
  });

  async function startCamera() {
    if (isMobile) return;

    try {
      error = null;
      loading = true;
      cameraOpen = true;

      // Attendre que le DOM soit mis à jour
      await new Promise(r => setTimeout(r, 50));

      const constraints = {
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      };

      stream = await navigator.mediaDevices.getUserMedia(constraints);

      if (videoElement && stream) {
        videoElement.srcObject = stream;
        await videoElement.play();
      } else {
        throw new Error('Impossible d\'initialiser la vidéo');
      }
    } catch (err: unknown) {
      cameraOpen = false;
      const errorMsg = err instanceof Error ? err.message : 'Impossible d\'accéder à la caméra';

      // Messages d'erreur plus explicites
      if (errorMsg.includes('Permission denied') || errorMsg.includes('NotAllowedError')) {
        error = 'Accès à la caméra refusé. Veuillez autoriser l\'accès dans les paramètres du navigateur.';
      } else if (errorMsg.includes('NotFoundError') || errorMsg.includes('DevicesNotFoundError')) {
        error = 'Aucune caméra détectée sur cet appareil.';
      } else {
        error = errorMsg;
      }
      console.error('Erreur caméra:', err);
    } finally {
      loading = false;
    }
  }

  function stopCamera() {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      stream = null;
    }
    cameraOpen = false;
  }

  async function capturePhoto() {
    if (!videoElement || !canvasElement) return;

    try {
      error = null;
      const context = canvasElement.getContext('2d');
      if (!context) return;

      // Définir les dimensions du canvas
      canvasElement.width = videoElement.videoWidth;
      canvasElement.height = videoElement.videoHeight;

      // Dessiner l'image du flux vidéo
      context.drawImage(videoElement, 0, 0);

      // Convertir le canvas en blob et créer un File
      canvasElement.toBlob((blob) => {
        if (blob) {
          const file = new File(
            [blob],
            `photo-${Date.now()}.jpg`,
            { type: 'image/jpeg' }
          );
          onPhoto(file);
          stopCamera();
        }
      }, 'image/jpeg', 0.95);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Erreur lors de la capture';
      error = errorMsg;
      console.error('Erreur capture:', err);
    }
  }

  function handleFileSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) {
      onPhoto(file);
    }
    input.value = '';
  }

  function openFileSelector() {
    fileInputRef?.click();
  }

  function openCameraCapture() {
    // Sur mobile, utiliser l'input avec capture pour ouvrir la caméra native
    cameraInputRef?.click();
  }
</script>

<div class="camera-input-container">
  {#if error}
    <div class="error-message">
      <Icon name="alert-circle" size={20} />
      <span>{error}</span>
      <button class="btn-dismiss" onclick={() => error = null}>×</button>
    </div>
  {/if}

  {#if cameraOpen && !isMobile}
    <!-- Mode webcam PC -->
    <div class="camera-view">
      <!-- svelte-ignore a11y_media_has_caption -->
      <video bind:this={videoElement} autoplay playsinline muted></video>
      <canvas bind:this={canvasElement} style="display: none;"></canvas>

      <div class="camera-controls">
        <button
          class="btn-capture"
          onclick={capturePhoto}
          title="Capturer une photo"
        >
          <Icon name="camera" size={24} />
        </button>
        <button
          class="btn-close"
          onclick={stopCamera}
          title="Fermer la caméra"
        >
          <Icon name="x" size={24} />
        </button>
      </div>
    </div>
  {:else}
    <div class="button-group">
      {#if isMobile}
        <!-- Sur mobile : bouton qui ouvre la caméra native via input capture -->
        <button
          class="btn-camera"
          onclick={openCameraCapture}
          disabled={disabled}
        >
          <Icon name="camera" size={18} />
          Prendre une photo
        </button>

        <!-- Input caché avec capture="user" pour la caméra native sur mobile -->
        <input
          bind:this={cameraInputRef}
          type="file"
          accept="image/*"
          capture="user"
          onchange={handleFileSelect}
          style="display: none;"
        />
      {:else if canUseWebcam}
        <!-- Sur PC avec webcam : bouton pour ouvrir le flux vidéo -->
        <button
          class="btn-camera"
          onclick={startCamera}
          disabled={loading || disabled}
        >
          {#if loading}
            <Spinner size={18} />
          {:else}
            <Icon name="camera" size={18} />
          {/if}
          Utiliser la webcam
        </button>
      {/if}

      <!-- Bouton import fichier (toujours disponible) -->
      <button
        class="btn-file"
        onclick={openFileSelector}
        disabled={disabled}
      >
        <Icon name="upload" size={18} />
        {isMobile ? 'Choisir depuis la galerie' : 'Importer une photo'}
      </button>
    </div>

    <!-- Input caché pour sélection de fichier -->
    <input
      bind:this={fileInputRef}
      type="file"
      accept="image/*"
      onchange={handleFileSelect}
      style="display: none;"
    />
  {/if}
</div>

<style>
  .camera-input-container {
    width: 100%;
  }

  .error-message {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 1rem;
    margin-bottom: 1rem;
    background-color: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: 0.5rem;
    color: var(--error, #ef4444);
    font-size: 0.875rem;
  }

  .error-message .btn-dismiss {
    margin-left: auto;
    background: none;
    border: none;
    color: var(--error, #ef4444);
    font-size: 1.25rem;
    cursor: pointer;
    padding: 0 0.25rem;
    line-height: 1;
  }

  .error-message .btn-dismiss:hover {
    color: #dc2626;
  }

  .button-group {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .btn-camera,
  .btn-file {
    flex: 1;
    min-width: 150px;
    padding: 0.75rem 1rem;
    border: 2px solid var(--border, rgba(0, 0, 0, 0.1));
    border-radius: 0.5rem;
    background: var(--bg-tertiary, #f3f4f6);
    color: var(--text-primary, #111827);
    font-size: 0.9375rem;
    font-weight: 500;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    transition: all 0.3s ease;
  }

  .btn-camera:hover:not(:disabled),
  .btn-file:hover:not(:disabled) {
    background: var(--bg-quaternary, #e5e7eb);
    border-color: var(--accent, #3b82f6);
  }

  .btn-camera:disabled,
  .btn-file:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .camera-view {
    position: relative;
    width: 100%;
    background: #000;
    border-radius: 0.5rem;
    overflow: hidden;
    margin-bottom: 1rem;
  }

  video {
    width: 100%;
    height: auto;
    display: block;
    max-height: 70vh;
    object-fit: cover;
  }

  .camera-controls {
    display: flex;
    gap: 1rem;
    justify-content: center;
    align-items: center;
    padding: 1rem;
    background: rgba(0, 0, 0, 0.7);
  }

  .btn-capture,
  .btn-close {
    width: 56px;
    height: 56px;
    border-radius: 50%;
    border: none;
    background: rgba(255, 255, 255, 0.1);
    color: #ffffff;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.3s ease;
  }

  .btn-capture {
    background: var(--accent, #3b82f6);
    width: 64px;
    height: 64px;
  }

  .btn-capture:hover {
    background: var(--accent-hover, #2563eb);
    transform: scale(1.1);
  }

  .btn-close:hover {
    background: rgba(255, 255, 255, 0.2);
  }

  @media (max-width: 640px) {
    .button-group {
      flex-direction: column;
    }

    .btn-camera,
    .btn-file {
      min-width: unset;
      width: 100%;
    }

    video {
      max-height: 60vh;
    }
  }
</style>
