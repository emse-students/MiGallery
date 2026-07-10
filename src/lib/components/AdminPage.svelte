<script lang="ts">
	import type { Component, Snippet } from 'svelte';

	interface Props {
		title: string;
		subtitle?: string | null;
		/** Lucide icon component shown in the header badge. */
		icon?: Component;
		/** Right-aligned header actions (buttons, links). */
		actions?: Snippet;
		children: Snippet;
		/** Max content width. */
		maxWidth?: string;
	}

	let { title, subtitle = null, icon, actions, children, maxWidth = '1100px' }: Props = $props();
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

	<div class="admin-page-body">
		{@render children()}
	</div>
</div>

<style>
	.admin-page {
		max-width: var(--admin-max);
		margin: 0 auto;
		padding: 2rem;
	}
	.admin-page-header {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-bottom: 1.75rem;
		flex-wrap: wrap;
	}
	.admin-page-icon {
		width: 48px;
		height: 48px;
		min-width: 48px;
		background: var(--gradient-brand);
		color: #fff;
		border-radius: var(--radius-md);
		display: flex;
		align-items: center;
		justify-content: center;
		box-shadow: 0 4px 12px color-mix(in srgb, var(--accent) 30%, transparent);
	}
	.admin-page-heading {
		flex: 1;
		min-width: 200px;
	}
	/* Scoped: wins over the global h1 in shared-admin.css. */
	.admin-page-heading h1 {
		font-size: 1.6rem;
		font-weight: 700;
		margin: 0;
		color: var(--text-primary);
		line-height: 1.2;
	}
	.admin-page-subtitle {
		color: var(--text-secondary);
		font-size: 0.9rem;
		margin: 0.25rem 0 0;
	}
	.admin-page-actions {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-left: auto;
	}

	@media (max-width: 640px) {
		.admin-page {
			padding: 1.25rem;
		}
	}
</style>
