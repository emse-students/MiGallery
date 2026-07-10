<script lang="ts">
	import type { ComponentType, SvelteComponent, Snippet } from 'svelte';

	interface Props {
		title: string;
		subtitle?: string | null;
		/** Lucide icon component shown in the header badge. */
		icon?: ComponentType<SvelteComponent>;
		/** Right-aligned header actions (buttons, links). */
		actions?: Snippet;
		children: Snippet;
		/** Max content width (CSS length). */
		maxWidth?: string;
	}

	let { title, subtitle = null, icon, actions, children, maxWidth = '900px' }: Props = $props();
	const Icon = $derived(icon);
</script>

<div class="admin-page" style="--admin-max: {maxWidth}">
	<header class="admin-page-header">
		{#if Icon}
			<div class="admin-page-icon"><Icon size={26} /></div>
		{/if}
		<div class="admin-page-heading">
			<h1>{title}</h1>
			{#if subtitle}<p class="admin-page-subtitle">{subtitle}</p>{/if}
		</div>
		{#if actions}
			<div class="admin-page-actions">{@render actions()}</div>
		{/if}
	</header>

	{@render children()}
</div>

<style>
	.admin-page {
		width: 100%;
		max-width: var(--admin-max);
		margin: 0 auto;
		padding: 1.5rem 1rem;
	}

	@media (min-width: 640px) {
		.admin-page {
			padding: 2.5rem 1.5rem;
		}
	}

	.admin-page-header {
		display: flex;
		align-items: center;
		gap: 1.25rem;
		margin-bottom: 2rem;
		flex-wrap: wrap;
	}

	.admin-page-icon {
		width: 52px;
		height: 52px;
		flex-shrink: 0;
		background: var(--gradient-brand);
		color: #fff;
		border-radius: var(--radius-md);
		display: flex;
		align-items: center;
		justify-content: center;
		box-shadow: 0 8px 16px color-mix(in srgb, var(--accent) 25%, transparent);
	}

	.admin-page-heading {
		flex: 1;
		min-width: 0;
	}

	/* Scoped: wins over the global bare h1 in shared-admin.css. */
	.admin-page-heading h1 {
		font-size: clamp(1.4rem, 4vw, 1.8rem);
		font-weight: 700;
		margin: 0;
		color: var(--text-primary);
		letter-spacing: -0.02em;
		line-height: 1.2;
	}

	.admin-page-subtitle {
		color: var(--text-secondary);
		font-size: 0.95rem;
		margin: 0.25rem 0 0;
	}

	.admin-page-actions {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-left: auto;
	}
</style>
