<!--
  FacePhotoDialog.svelte - the whole photograph behind a face the member is asked about.

  A face cropped alone is often not enough to say "it is me": the surroundings are. The picture is
  the same preview every member's viewer reads (`/api/immich/assets/{id}/thumbnail`), so it opens
  nothing the gallery did not already serve; the proposed face stays beside it as a chip. The
  member answers from here without going back to the list. Escape and a click outside close it
  and answer nothing.
-->
<script lang="ts">
  import { Check, X } from '@lucide/svelte';
  import FaceCropThumb from '#lib/components/FaceCropThumb.svelte';
  import { m } from '#lib/paraglide/messages.js';
  import type { Suggestion, Verdict } from '#lib/face-confirm-list.ts';

  interface Props {
    /** The face whose photo is shown; null keeps the dialog closed. */
    item: Suggestion | null;
    onAnswer: (verdict: Verdict) => void;
    onClose: () => void;
  }

  let { item, onAnswer, onClose }: Props = $props();

  let dialog: HTMLDialogElement | undefined = $state();
  /** The preview did not load: say so instead of leaving an empty frame. */
  let failed = $state(false);

  $effect(() => {
    if (!dialog) return;
    if (item && !dialog.open) {
      failed = false;
      dialog.showModal();
    } else if (!item && dialog.open) {
      dialog.close();
    }
  });

  /** A click on the backdrop (the dialog element itself, not its content) closes it. */
  function onBackdrop(event: MouseEvent) {
    if (event.target === dialog) onClose();
  }
</script>

<dialog
  bind:this={dialog}
  class="face-photo"
  aria-label={m.mpc_dialog_label()}
  onclose={onClose}
  onclick={onBackdrop}
>
  {#if item}
    <div class="face-photo-frame">
      {#if failed}
        <p class="face-photo-failed">{m.mpc_dialog_photo_failed()}</p>
      {:else}
        <img
          src={`/api/immich/assets/${encodeURIComponent(item.asset_id)}/thumbnail?size=preview`}
          alt={m.mpc_dialog_photo_alt()}
          onerror={() => {
            console.warn('[confirmer] the whole photo did not load');
            failed = true;
          }}
        />
      {/if}
      <div class="face-photo-chip" title={m.mpc_dialog_face()}>
        <FaceCropThumb
          assetId={item.asset_id}
          faceIndex={item.face_index}
          alt={m.mpc_dialog_face()}
        />
      </div>
    </div>
    <div class="face-photo-actions">
      <button type="button" class="face-photo-btn" onclick={onClose}>
        <X size={18} aria-hidden="true" />
        <span>{m.common_close()}</span>
      </button>
      <button type="button" class="face-photo-btn" onclick={() => onAnswer('reject')}>
        <span>{m.mpc_not_me()}</span>
      </button>
      <button type="button" class="face-photo-btn yes" onclick={() => onAnswer('confirm')}>
        <Check size={18} aria-hidden="true" />
        <span>{m.mpc_me()}</span>
      </button>
    </div>
  {/if}
</dialog>

<style>
  .face-photo {
    width: min(92vw, 44rem);
    max-height: 92vh;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--bg-secondary);
    color: var(--text-primary);
    overflow: hidden;
  }

  .face-photo::backdrop {
    background: rgb(0 0 0 / 0.6);
  }

  .face-photo-frame {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 12rem;
    background: var(--bg-tertiary);
  }

  .face-photo-frame img {
    display: block;
    max-width: 100%;
    max-height: 70vh;
    object-fit: contain;
  }

  .face-photo-failed {
    margin: 0;
    padding: 2rem 1rem;
    color: var(--text-secondary);
    font-size: 0.875rem;
  }

  /* The proposed face, so the member knows WHICH face of the photo is asked about. */
  .face-photo-chip {
    position: absolute;
    left: 0.75rem;
    bottom: 0.75rem;
    width: 4.5rem;
    height: 4.5rem;
    overflow: hidden;
    border: 2px solid white;
    border-radius: var(--radius-sm);
    box-shadow: 0 1px 6px rgb(0 0 0 / 0.5);
  }

  .face-photo-actions {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 0.5rem;
    padding: 0.75rem;
  }

  .face-photo-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    min-width: 0;
    min-height: 2.75rem;
    padding: 0.4rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-tertiary);
    color: var(--text-primary);
    font-size: 0.8125rem;
    font-weight: 600;
    line-height: 1.15;
    text-align: center;
    white-space: normal;
    overflow-wrap: anywhere;
  }

  .face-photo-btn.yes {
    border-color: transparent;
    background: var(--accent);
    color: white;
  }

  .face-photo-btn:hover {
    border-color: var(--accent);
  }
</style>
