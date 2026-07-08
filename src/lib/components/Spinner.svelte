<script lang="ts">
  let { size = 24, ariaLabel = null }: { size?: number; ariaLabel?: string | null } = $props();
</script>

<div class="spinner" role="status" aria-hidden={ariaLabel ? "false" : "true"} aria-label={ariaLabel} style="width: {size}px; height: {size}px;"></div>

<style>
  .spinner {
    display: inline-block;
    vertical-align: middle;
    /* Inherit the surrounding text color so it stays visible in both themes
       and on colored buttons (e.g. white on an accent background). */
    border: 3px solid color-mix(in srgb, currentColor 25%, transparent);
    border-top-color: currentColor;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
