<script lang="ts">
  import { toast } from '$lib/toast';
  import Toast from './Toast.svelte';
</script>

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

<style>
  .toast-container {
    position: fixed;
    top: 1rem;
    right: 1rem;
    z-index: 9999;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    pointer-events: none;
  }

  @media (max-width: 640px) {
    .toast-container {
      left: 1rem;
      right: 1rem;
    }
  }
</style>
