<!--
  Button.svelte - Shared button primitive built on the design tokens.

  Renders an <a> when `href` is set, otherwise a <button>. Keeps one consistent
  button look across the app instead of the divergent per-page button styles.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
	type Size = 'sm' | 'md';

	interface Props {
		variant?: Variant;
		size?: Size;
		href?: string;
		type?: 'button' | 'submit' | 'reset';
		disabled?: boolean;
		title?: string;
		ariaLabel?: string;
		block?: boolean;
		onclick?: (e: MouseEvent) => void;
		children: Snippet;
	}

	let {
		variant = 'secondary',
		size = 'md',
		href,
		type = 'button',
		disabled = false,
		title,
		ariaLabel,
		block = false,
		onclick,
		children
	}: Props = $props();
</script>

{#if href}
	<a
		{href}
		class="ui-btn {variant} {size}"
		class:block
		class:disabled
		{title}
		aria-label={ariaLabel}
		aria-disabled={disabled}
		{onclick}
	>
		{@render children()}
	</a>
{:else}
	<button
		{type}
		class="ui-btn {variant} {size}"
		class:block
		{disabled}
		{title}
		aria-label={ariaLabel}
		{onclick}
	>
		{@render children()}
	</button>
{/if}

<style>
	.ui-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		font-family: inherit;
		font-weight: 600;
		line-height: 1;
		white-space: nowrap;
		border: 1px solid transparent;
		border-radius: var(--radius-xs);
		cursor: pointer;
		text-decoration: none;
		transition:
			background-color 0.18s var(--ease),
			border-color 0.18s var(--ease),
			color 0.18s var(--ease),
			transform 0.18s var(--ease);
	}

	.ui-btn.md {
		padding: 0.55rem 1rem;
		font-size: 0.875rem;
	}

	.ui-btn.sm {
		padding: 0.4rem 0.7rem;
		font-size: 0.8125rem;
	}

	.ui-btn.block {
		width: 100%;
	}

	.ui-btn:focus-visible {
		outline: none;
		box-shadow: 0 0 0 3px var(--accent-light);
	}

	.ui-btn.primary {
		background: var(--accent);
		color: #fff;
	}
	.ui-btn.primary:hover:not(:disabled):not(.disabled) {
		background: var(--accent-hover);
		transform: translateY(-1px);
	}

	.ui-btn.secondary {
		background: var(--bg-elevated);
		color: var(--text-primary);
		border-color: var(--border);
	}
	.ui-btn.secondary:hover:not(:disabled):not(.disabled) {
		background: var(--bg-tertiary);
		border-color: var(--accent);
		color: var(--accent);
	}

	.ui-btn.danger {
		background: var(--error);
		color: #fff;
	}
	.ui-btn.danger:hover:not(:disabled):not(.disabled) {
		filter: brightness(0.92);
		transform: translateY(-1px);
	}

	.ui-btn.ghost {
		background: transparent;
		color: var(--text-secondary);
	}
	.ui-btn.ghost:hover:not(:disabled):not(.disabled) {
		background: var(--bg-tertiary);
		color: var(--text-primary);
	}

	.ui-btn:disabled,
	.ui-btn.disabled {
		opacity: 0.5;
		cursor: not-allowed;
		transform: none;
		pointer-events: none;
	}
</style>
