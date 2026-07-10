<script lang="ts">
	import type { ComponentType, SvelteComponent, Snippet } from 'svelte';
	import { Inbox } from 'lucide-svelte';

	interface Props {
		/** Lucide icon component (defaults to Inbox). */
		icon?: ComponentType<SvelteComponent>;
		title: string;
		description?: string | null;
		/** Visual size of the block. */
		size?: 'sm' | 'md';
		/** Optional action area (e.g. a button) rendered under the text. */
		children?: Snippet;
	}

	let { icon = Inbox, title, description = null, size = 'md', children }: Props = $props();
	const Icon = $derived(icon);
</script>

<div class="empty-state {size}">
	<Icon size={size === 'sm' ? 32 : 48} />
	<p class="empty-title">{title}</p>
	{#if description}
		<p class="empty-desc">{description}</p>
	{/if}
	{#if children}
		<div class="empty-action">{@render children()}</div>
	{/if}
</div>

<style>
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		text-align: center;
		color: var(--text-muted);
	}
	.empty-state.md {
		padding: 3rem 2rem;
	}
	.empty-state.sm {
		padding: 1.75rem 1rem;
	}
	.empty-state :global(svg) {
		opacity: 0.5;
	}
	.empty-title {
		margin: 0;
		font-weight: 600;
		color: var(--text-secondary);
	}
	.empty-desc {
		margin: 0;
		font-size: 0.9rem;
		color: var(--text-muted);
		max-width: 40ch;
	}
	.empty-action {
		margin-top: 0.5rem;
	}
</style>
