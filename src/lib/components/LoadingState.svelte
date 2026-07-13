<script lang="ts">
	import Spinner from './Spinner.svelte';

	interface Props {
		/** Optional label shown next to / under the spinner. */
		label?: string | null;
		/** inline = spinner + label on one row (default); block = stacked, larger. */
		layout?: 'inline' | 'block';
	}

	let { label = null, layout = 'inline' }: Props = $props();
</script>

<div class="loading-state {layout}" role="status" aria-live="polite">
	<Spinner size={layout === 'block' ? 40 : 20} />
	{#if label}<span class="loading-label">{label}</span>{/if}
</div>

<style>
	.loading-state {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		text-align: center;
		color: var(--text-secondary);
		padding: 3rem 2rem;
	}
	.loading-state.block {
		flex-direction: column;
	}
	.loading-label {
		font-size: 0.95rem;
	}
</style>
