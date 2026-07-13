<script lang="ts">
	import type { ComponentType, SvelteComponent, Snippet } from 'svelte';
	import { XCircle, RotateCcw } from 'lucide-svelte';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		/** Lucide icon component (defaults to XCircle). */
		icon?: ComponentType<SvelteComponent>;
		/** Primary message (usually the error text). */
		title: string;
		description?: string | null;
		/** Visual size of the block. */
		size?: 'sm' | 'md';
		/** When provided, renders a standard "retry" button wired to this callback. */
		onRetry?: (() => void) | null;
		/** Extra action(s) rendered alongside the retry button. */
		children?: Snippet;
	}

	let {
		icon = XCircle,
		title,
		description = null,
		size = 'md',
		onRetry = null,
		children
	}: Props = $props();
	const Icon = $derived(icon);
</script>

<div class="error-state {size}" role="alert">
	<Icon size={size === 'sm' ? 32 : 48} />
	<p class="error-title">{title}</p>
	{#if description}
		<p class="error-desc">{description}</p>
	{/if}
	{#if onRetry || children}
		<div class="error-action">
			{#if onRetry}
				<button type="button" class="btn-glass" onclick={onRetry}>
					<RotateCcw size={16} />
					{m.common_retry()}
				</button>
			{/if}
			{#if children}{@render children()}{/if}
		</div>
	{/if}
</div>

<style>
	.error-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		text-align: center;
		color: var(--error);
		border: 1px solid color-mix(in srgb, var(--error) 25%, transparent);
		background: color-mix(in srgb, var(--error) 8%, transparent);
		border-radius: var(--radius);
	}
	.error-state.md {
		padding: 3rem 2rem;
	}
	.error-state.sm {
		padding: 1.75rem 1rem;
	}
	.error-state :global(svg) {
		opacity: 0.9;
	}
	.error-title {
		margin: 0;
		font-weight: 600;
		color: var(--text-primary);
	}
	.error-desc {
		margin: 0;
		font-size: 0.9rem;
		color: var(--text-secondary);
		max-width: 40ch;
	}
	.error-action {
		margin-top: 0.5rem;
	}
</style>
