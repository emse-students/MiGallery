<script lang="ts">
  import Modal from '$lib/components/Modal.svelte';
  import { confirmStore, resolveConfirm } from '$lib/confirm';
  import { onDestroy } from 'svelte';

  let state = $state({ show: false } as any);

  const unsubscribe = confirmStore.subscribe((s) => {
    state = s || { show: false };
  });

  function onConfirm() {
    resolveConfirm(true);
  }

  function onCancel() {
    resolveConfirm(false);
  }

  onDestroy(() => {
    unsubscribe();
  });
</script>

{#if state?.show}
  <Modal
    bind:show={state.show}
    title={state.title}
    type="confirm"
    confirmText={state.confirmText}
    cancelText={state.cancelText}
    onConfirm={onConfirm}
    onCancel={onCancel}
  >
    <p style="white-space: pre-wrap;">{state.message}</p>
  </Modal>
{/if}
