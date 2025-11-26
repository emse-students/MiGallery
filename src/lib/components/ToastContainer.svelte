<script lang="ts">
  import { toast } from '$lib/toast';
  import Toast from './Toast.svelte';
</script>

<div class="toast-wrapper">
  {#if $toast.length > 0}
    <div class="toast-backdrop" aria-hidden="true"></div>
  {/if}

  <div class="toast-container">
    {#each $toast as toastItem (toastItem.id)}
      <Toast
        message={toastItem.message}
        type={toastItem.type}
        duration={toastItem.duration}
        onClose={() => toast.dismiss(toastItem.id)}
      />
    {/each}
  </div>
</div>

<style>
  .toast-wrapper {
    position: fixed;
    top: 1rem;
    right: 1rem;
    z-index: 9999;
    pointer-events: none;
    display: inline-block; /* shrinkwrap to content */
  }

  .toast-container {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    pointer-events: none;
    position: relative; /* establish stacking context for backdrop */
    z-index: 2;
  }

  .toast-backdrop {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    left: 0;
    background: rgba(0, 0, 0, 0.45);
    border-radius: 0.5rem;
    z-index: 1;
    pointer-events: none; /* allow clicks through */
  }

  @media (max-width: 640px) {
    .toast-container {
      left: 1rem;
      right: 1rem;
    }
  }
</style>
