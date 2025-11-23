<script lang="ts">
  import ConfirmModal from '$lib/components/ConfirmModal.svelte';
  import { confirmStore, resolveConfirm } from '$lib/confirm';

  let state = $state({ show: false } as any);

  import { onDestroy } from 'svelte';

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
  <ConfirmModal
    title={state.title}
    message={state.message}
    confirmText={state.confirmText}
    cancelText={state.cancelText}
    onConfirm={onConfirm}
    onCancel={onCancel}
  />
{/if}
