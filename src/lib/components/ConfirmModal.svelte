<script lang="ts">
  import Icon from './Icon.svelte';

  interface Props {
    title?: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    confirmVariant?: 'danger' | 'primary' | 'warning';
    onConfirm: () => void;
    onCancel: () => void;
  }

  let { 
    title = 'Confirmation',
    message,
    confirmText = 'Confirmer',
    cancelText = 'Annuler',
    confirmVariant = 'danger',
    onConfirm,
    onCancel
  }: Props = $props();

  function handleConfirm() {
    onConfirm();
  }

  function handleCancel() {
    onCancel();
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      handleCancel();
    }
  }
</script>

<div class="modal-backdrop" onclick={handleBackdropClick} role="presentation">
  <div class="modal-content" role="dialog" aria-modal="true">
    <div class="modal-header">
      <h2 class="modal-title">{title}</h2>
      <button class="close-btn" onclick={handleCancel} aria-label="Fermer">
        <Icon name="x" size={20} />
      </button>
    </div>
    
    <div class="modal-body">
      <p class="modal-message">{message}</p>
    </div>
    
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick={handleCancel}>
        {cancelText}
      </button>
      <button class="btn btn-{confirmVariant}" onclick={handleConfirm}>
        {confirmText}
      </button>
    </div>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.75);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
    padding: 1rem;
    animation: fadeIn 0.2s ease-out;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  .modal-content {
    background: var(--bg-elevated, #1e1e1e);
    border-radius: 12px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
    max-width: 500px;
    width: 100%;
    animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    border: 1px solid rgba(255, 255, 255, 0.1);
  }

  @keyframes slideUp {
    from {
      opacity: 0;
      transform: translateY(20px) scale(0.95);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1.5rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  .modal-title {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--text-primary, #ffffff);
  }

  .close-btn {
    background: transparent;
    border: none;
    color: var(--text-secondary, #a0a0a0);
    cursor: pointer;
    padding: 0.25rem;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
  }

  .close-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    color: var(--text-primary, #ffffff);
  }

  .modal-body {
    padding: 1.5rem;
  }

  .modal-message {
    margin: 0;
    color: var(--text-secondary, #d0d0d0);
    line-height: 1.6;
    white-space: pre-wrap;
  }

  .modal-footer {
    display: flex;
    gap: 0.75rem;
    padding: 1.5rem;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    justify-content: flex-end;
  }

  .btn {
    padding: 0.625rem 1.25rem;
    border: none;
    border-radius: 8px;
    font-weight: 500;
    font-size: 0.9375rem;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-secondary {
    background: var(--bg-tertiary, #2a2a2a);
    color: var(--text-primary, #ffffff);
  }

  .btn-secondary:hover:not(:disabled) {
    background: var(--bg-quaternary, #353535);
  }

  .btn-danger {
    background: #dc2626;
    color: white;
  }

  .btn-danger:hover:not(:disabled) {
    background: #b91c1c;
  }

  .btn-primary {
    background: #3b82f6;
    color: white;
  }

  .btn-primary:hover:not(:disabled) {
    background: #2563eb;
  }

  .btn-warning {
    background: #f59e0b;
    color: white;
  }

  .btn-warning:hover:not(:disabled) {
    background: #d97706;
  }
</style>
