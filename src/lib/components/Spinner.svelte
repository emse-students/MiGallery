<script lang="ts">
  let { size = 24, ariaLabel = null }: { size?: number; ariaLabel?: string | null } = $props();
</script>

<div class="spinner" role="status" aria-hidden={ariaLabel ? "false" : "true"} aria-label={ariaLabel} style="width: {size}px; height: {size}px;"></div>

<style>
  .spinner {
    display: inline-block;
    vertical-align: middle;
    border: 3px solid rgba(255, 255, 255, 0.2);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
