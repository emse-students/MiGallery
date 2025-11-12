<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';

  interface Props {
    message: string;
    type?: 'info' | 'success' | 'error' | 'warning';
    duration?: number;
    onClose?: () => void;
  }

  let {
    message,
    type = 'info',
    duration = 3000,
    onClose
  }: Props = $props();

  let visible = $state(true);

  const typeConfig = $derived({
    info: { icon: 'info', color: 'bg-blue-500' },
    success: { icon: 'check-circle', color: 'bg-green-500' },
    error: { icon: 'x-circle', color: 'bg-red-500' },
    warning: { icon: 'alert-triangle', color: 'bg-yellow-500' }
  }[type]);

  onMount(() => {
    if (duration > 0) {
      const timer = setTimeout(() => {
        visible = false;
        setTimeout(() => {
          if (onClose) onClose();
        }, 300);
      }, duration);

      return () => clearTimeout(timer);
    }
  });

  function handleClose() {
    visible = false;
    setTimeout(() => {
      if (onClose) onClose();
    }, 300);
  }
</script>

<div class="toast {typeConfig.color}" class:visible>
  <Icon name={typeConfig.icon} size={20} class="text-white" />
  <span class="toast-message">{message}</span>
  <button type="button" class="toast-close" onclick={handleClose} aria-label="Fermer">
    <Icon name="x" size={16} class="text-white" />
  </button>
</div>

<style>
  .toast {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    border-radius: 0.5rem;
    box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1),
                0 4px 6px -2px rgba(0, 0, 0, 0.05);
    color: white;
    min-width: 300px;
    max-width: 500px;
    opacity: 0;
    transform: translateY(-1rem);
    transition: all 0.3s ease;
    pointer-events: all;
  }

  .toast.visible {
    opacity: 1;
    transform: translateY(0);
  }

  .toast-message {
    flex: 1;
    font-size: 0.875rem;
    font-weight: 500;
  }

  .toast-close {
    background: none;
    border: none;
    cursor: pointer;
    padding: 0.25rem;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0.8;
    transition: opacity 0.2s;
  }

  .toast-close:hover {
    opacity: 1;
  }
</style>
