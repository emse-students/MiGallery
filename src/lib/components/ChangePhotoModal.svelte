<script lang="ts">
  import { onMount } from 'svelte';
  import { Image as ImageIcon, CircleAlert, CircleCheckBig } from '@lucide/svelte';
  import Spinner from './Spinner.svelte';
  import EmptyState from './EmptyState.svelte';
  import Modal from './Modal.svelte';
  import FaceCropThumb from './FaceCropThumb.svelte';
  import type { ImmichAsset } from '#lib/types/api.ts';
  import { consumeNDJSONStream } from '#lib/streaming.ts';
  import { m } from '#lib/paraglide/messages.js';

  interface Props {
    currentPhotoUrl?: string;
    onClose: () => void;
    onPhotoSelected?: (assetId: string) => void;
    /** The member whose profile photo changes: it is chosen among THEIR photos (lot A6). */
    memberId?: string;
    /**
     * The member picks for themselves: each tile is THEIR FACE, cut as on the confirmation screen
     * (a crop is served to its holder alone, so an admin picking for someone else sees the photos).
     */
    ownFace?: boolean;
  }

  let { currentPhotoUrl, onClose, onPhotoSelected, memberId, ownFace = false }: Props = $props();

  /** For each photo, the member's face a tile shows; and the current photo and how it was set. */
  let faces = $state<Record<string, number>>({});
  let current = $state<{ asset_id: string; source: 'chosen' | 'default' | null } | null>(null);

  let show = $state(true);
  let selectedAssetId = $state<string | null>(null);
  let loading = $state(false);
  let assets = $state<ImmichAsset[]>([]);
  let loadingAssets = $state(true);
  let error = $state<string | null>(null);

  /** The member's own photos (their face matches), every one of them, as the picker's choices. */
  async function loadUserPhotos() {
    if (!memberId) {
      error = m.changephoto_no_user();
      loadingAssets = false;
      return;
    }

    try {
      loadingAssets = true;
      error = null;
      // The member's faces and current photo, then the photos IN THEIR ORDER (newest first, as the
      // stream gives them): the picker is chronological, never ranked (owner, 2026-11-01).
      const query = ownFace ? '' : `?user_id=${encodeURIComponent(memberId)}`;
      const infoRes = await fetch(`/api/users/me/profile-photo${query}`);
      if (!infoRes.ok) {
        throw new Error(`profile photo read refused (${infoRes.status})`);
      }
      const info = (await infoRes.json()) as {
        faces?: Record<string, number>;
        current?: { asset_id: string; source: 'chosen' | 'default' | null } | null;
      };
      faces = info.faces ?? {};
      current = info.current ?? null;
      const res = await fetch(`/api/users/${encodeURIComponent(memberId)}/photos-stream`);
      const found: ImmichAsset[] = [];
      await consumeNDJSONStream<{ asset: ImmichAsset }>(res, ({ asset }) => {
        // Only a photo with a visible face of theirs can be cut into an avatar.
        if (faces[asset.id] !== undefined) found.push(asset);
      });
      assets = found;
    } catch (e: unknown) {
      console.error('[change-photo] the member photos could not be loaded', e);
      error = m.cpm_load_error();
    } finally {
      loadingAssets = false;
    }
  }

  async function handlePhotoSelect(assetId: string) {
    selectedAssetId = assetId;
  }

  async function confirmSelection() {
    if (!selectedAssetId) return;
    if (!onPhotoSelected) {
      onClose();
      return;
    }
    loading = true;
    try {
      // The caller's onPhotoSelected already reloads the page after persisting;
      // a second reload here would race with (and abort) that navigation.
      await onPhotoSelected(selectedAssetId);
      onClose();
    } catch (e: unknown) {
      console.error('Error during confirmation:', e);
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    loadUserPhotos();
  });
</script>

<Modal
  bind:show
  title={m.cpm_title()}
  icon="camera"
  wide={true}
  confirmText={loading ? m.common_processing() : m.common_validate()}
  confirmDisabled={!selectedAssetId || loading}
  showCloseButton={true}
  onConfirm={confirmSelection}
  onCancel={onClose}
>
  <div class="current-photo-section">
    {#if currentPhotoUrl}
      <div class="current-photo">
        <img src={currentPhotoUrl} alt={m.cpm_current()} />
        <p>{m.cpm_current()}</p>
      </div>
    {/if}

    <div class="instructions">
      <ImageIcon size={20} />
      <p>{m.cpm_pick()}</p>
    </div>
  </div>

  {#if error}
    <div class="error-message">
      <CircleAlert size={20} />
      <p>{error}</p>
    </div>
  {/if}

  {#if loading}
    <div class="loading-state">
      <Spinner size={40} />
      <p>{m.cpm_updating()}</p>
    </div>
  {:else if loadingAssets}
    <div class="loading-state">
      <Spinner size={40} />
      <p>{m.cpm_loading()}</p>
    </div>
  {:else if assets.length > 0}
    <div class="photos-grid">
      {#each assets as asset (asset.id)}
        <div
          class="photo-item"
          class:selected={selectedAssetId === asset.id}
          class:current={current?.asset_id === asset.id}
        >
          {#if ownFace}
            <FaceCropThumb assetId={asset.id} faceIndex={faces[asset.id]} alt={m.cpm_face_alt()} />
          {:else}
            <img
              class="photo-thumb"
              src={`/api/immich/assets/${encodeURIComponent(asset.id)}/thumbnail?size=thumbnail`}
              alt={m.cpm_photo_alt()}
              loading="lazy"
              decoding="async"
            />
          {/if}
          <button
            type="button"
            class="photo-pick"
            aria-pressed={selectedAssetId === asset.id}
            aria-label={current?.asset_id === asset.id ? m.cpm_current() : m.cpm_photo_alt()}
            onclick={() => handlePhotoSelect(asset.id)}
            ondblclick={confirmSelection}
          ></button>
          {#if current?.asset_id === asset.id}
            <span class="current-badge">
              {current.source === 'default' ? m.cpm_default_badge() : m.cpm_current_badge()}
            </span>
          {/if}
          {#if selectedAssetId === asset.id}
            <div class="selected-overlay">
              <CircleCheckBig size={32} />
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {:else}
    <EmptyState icon={ImageIcon} title={m.pg_empty()} />
  {/if}
</Modal>

<style>
  /* The current photo sits beside the hint, so the grid - what the member came for - is in view. */
  .current-photo-section {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1rem;
  }

  .current-photo {
    flex-shrink: 0;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .current-photo img {
    width: 80px;
    height: 80px;
    border-radius: 50%;
    object-fit: cover;
    border: 3px solid var(--surface-border);
    margin-bottom: 0.35rem;
  }

  .current-photo p {
    max-width: 8rem;
    color: var(--text-secondary);
    font-size: 0.75rem;
    margin: 0;
  }

  .instructions {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 1rem;
    background: color-mix(in srgb, var(--info) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--info) 30%, transparent);
    border-radius: var(--radius-xs);
    color: var(--text-primary);
  }

  .instructions p {
    margin: 0;
    font-size: 0.875rem;
  }

  .error-message {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 1rem;
    background: color-mix(in srgb, var(--error) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--error) 30%, transparent);
    border-radius: var(--radius-xs);
    color: var(--error);
    margin-bottom: 1rem;
  }

  .error-message p {
    margin: 0;
    font-size: 0.875rem;
  }

  .photos-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
    gap: 0.75rem;
    margin-top: 1rem;
  }

  .photo-item {
    position: relative;
    display: block;
    aspect-ratio: 1;
    border-radius: var(--radius-xs);
    overflow: hidden;
    cursor: pointer;
    border: 2px solid transparent;
    transition: all 0.2s ease;
    background: var(--bg-tertiary);
    padding: 0;
  }

  .photo-item:hover {
    border-color: var(--surface-border-hover);
    z-index: 1;
  }

  /* Flat: the pick is a solid ring, not a coloured shadow (ui-redesign #25). */
  .photo-item.selected {
    border-color: var(--accent);
    outline: 3px solid color-mix(in srgb, var(--accent) 30%, transparent);
  }

  .photo-thumb {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  /* The whole tile picks; FaceCropThumb's retry sits above it (z-index 2). */
  .photo-pick {
    position: absolute;
    inset: 0;
    z-index: 1;
    padding: 0;
    border: none;
    background: transparent;
    cursor: pointer;
  }

  /* The current photo is ringed, and its badge wraps rather than being cut on a phone tile. */
  .photo-item.current:not(.selected) {
    border-color: var(--text-secondary);
  }

  .current-badge {
    position: absolute;
    left: 0.3rem;
    right: 0.3rem;
    bottom: 0.3rem;
    z-index: 1;
    padding: 0.15rem 0.4rem;
    border-radius: var(--radius-xs);
    text-align: center;
    line-height: 1.25;
    background: color-mix(in srgb, var(--bg-primary) 85%, transparent);
    color: var(--text-primary);
    font-size: 0.6875rem;
    font-weight: 600;
    overflow-wrap: break-word;
    pointer-events: none;
  }

  .selected-overlay {
    pointer-events: none;
    position: absolute;
    inset: 0;
    background: color-mix(in srgb, var(--accent) 30%, transparent);
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
  }

  .loading-state {
    text-align: center;
    padding: 2rem;
    color: var(--text-primary);
  }

  .loading-state p {
    margin-top: 1rem;
    color: var(--text-secondary);
  }

  @media (max-width: 768px) {
    .photos-grid {
      /* Three columns from 360 px up. */
      grid-template-columns: repeat(auto-fill, minmax(76px, 1fr));
      gap: 0.5rem;
      margin-top: 1rem;
    }

    .current-photo-section {
      gap: 0.75rem;
      margin-bottom: 0.75rem;
    }

    .current-photo img {
      width: 56px;
      height: 56px;
      margin-bottom: 0;
    }

    /* The caption would wrap to three lines beside the hint; the image alt and the badge on its
       tile in the grid say the same. Kept for screen readers. */
    .current-photo p {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }

    .instructions {
      padding: 0.6rem 0.75rem;
    }
  }
</style>
