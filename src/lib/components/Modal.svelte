<script lang="ts">
	import { onMount, type Snippet, type Component } from 'svelte';
	import {
		Info,
		CheckCircle,
		XCircle,
		AlertTriangle,
		CircleHelp,
		X,
		UserX,
		Camera
	} from 'lucide-svelte';

	interface Props {
		show: boolean;
		title?: string;
		icon?: string;
		type?: 'info' | 'success' | 'error' | 'warning' | 'confirm';
		confirmText?: string;
		cancelText?: string;
		onConfirm?: () => void | Promise<void>;
		onCancel?: () => void;
		children?: Snippet;
		wide?: boolean;
		confirmDisabled?: boolean;
		showCloseButton?: boolean;
	}

	let {
		show = $bindable(false),
		title = '',
		icon = '',
		type = 'info',
		confirmText = 'OK',
		cancelText = 'Annuler',
		onConfirm,
		onCancel,
		children,
		wide = false,
		confirmDisabled = false,
		showCloseButton = false
	}: Props = $props();

	let dialogElement: HTMLDialogElement;
	let isProcessing = $state(false);

	// Mapping des noms (string) vers composants Lucide
	const icons: Record<string, any> = {
		info: Info,
		'check-circle': CheckCircle,
		'x-circle': XCircle,
		'alert-triangle': AlertTriangle,
		'help-circle': CircleHelp,
		'user-x': UserX,
		camera: Camera,
		x: X
	};

	$effect(() => {
		if (!dialogElement) return;

		if (show && !dialogElement.open) {
			dialogElement.showModal();
		} else if (!show && dialogElement.open) {
			dialogElement.close();
		}
	});

	function handleKeydown(e: KeyboardEvent) {
		const active = document.activeElement as HTMLElement | null;

		if (e.key === 'Enter' && !isProcessing) {
			const tag = active?.tagName?.toUpperCase() || '';
			const isEditable = active?.isContentEditable;
			const ignoreEnter = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || isEditable;
			if (!ignoreEnter && typeof onConfirm === 'function') {
				e.preventDefault();
				void handleConfirm();
				return;
			}
		}

		if (e.key === 'Escape' && !isProcessing) {
			handleCancel();
		}
	}

	async function handleConfirm() {
		if (isProcessing) return;

		try {
			isProcessing = true;
			if (onConfirm) {
				await onConfirm();
			}
			show = false;
		} catch (error: unknown) {
			console.error('Erreur dans onConfirm:', error);
		} finally {
			isProcessing = false;
		}
	}

	function handleCancel() {
		if (isProcessing) return;

		if (onCancel) {
			onCancel();
		}
		show = false;
	}

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === dialogElement && !isProcessing) {
			handleCancel();
		}
	}

	const typeConfig = $derived(
		{
			info: { icon: 'info', color: 'text-blue-500' },
			success: { icon: 'check-circle', color: 'text-green-500' },
			error: { icon: 'x-circle', color: 'text-red-500' },
			warning: { icon: 'alert-triangle', color: 'text-yellow-500' },
			confirm: { icon: 'help-circle', color: 'text-blue-500' }
		}[type]
	);

	const iconName = $derived(icon || typeConfig.icon);
	const IconComponent = $derived(icons[iconName]);
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<dialog
	bind:this={dialogElement}
	class="modal-dialog"
	onkeydown={handleKeydown}
	onclick={handleBackdropClick}
>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="modal-content {wide ? 'modal-content-wide' : ''}"
		role="group"
		tabindex="-1"
		onclick={(e) => e.stopPropagation()}
		onkeydown={(e) => e.stopPropagation()}
	>
		{#if title || IconComponent}
			<div class="modal-header">
				<h2 class="modal-title">
					{#if IconComponent}
						<IconComponent size={24} class={typeConfig.color} />
					{/if}
					{title}
				</h2>
				{#if showCloseButton}
					<button class="close-btn" onclick={handleCancel} aria-label="Fermer">
						<X size={20} />
					</button>
				{/if}
			</div>
		{/if}

		<div class="modal-body">
			{#if children}
				{@render children()}
			{/if}
		</div>

		<div class="modal-actions">
			{#if type === 'confirm'}
				<button type="button" onclick={handleCancel} disabled={isProcessing} class="btn-secondary">
					{cancelText}
				</button>
				<button
					type="button"
					onclick={handleConfirm}
					disabled={isProcessing || confirmDisabled}
					class="btn-primary"
				>
					{isProcessing ? 'En cours...' : confirmText}
				</button>
			{:else}
				<button
					type="button"
					onclick={handleConfirm}
					disabled={isProcessing || confirmDisabled}
					class="btn-primary"
				>
					{isProcessing ? 'En cours...' : confirmText}
				</button>
			{/if}
		</div>
	</div>
</dialog>

<style>
	.modal-dialog {
		border: none;
		border-radius: 0.75rem;
		padding: 0;
		background: transparent;
		max-width: 90vw;
		max-height: 90vh;
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		margin: 0;
		z-index: 10050;
	}

	.modal-dialog::backdrop {
		background: rgba(0, 0, 0, 0.65);
		backdrop-filter: blur(8px) saturate(130%);
	}

	.modal-content {
		/* Glassmorphism modal surface (more opaque for better legibility) */
		background: rgba(255, 255, 255, 0.22);
		border: 1px solid rgba(255, 255, 255, 0.2);
		border-radius: 0.9rem;
		padding: 1.5rem;
		min-width: 400px;
		max-width: 600px;
		box-shadow: 0 12px 40px rgba(2, 6, 23, 0.6);
		backdrop-filter: blur(10px) saturate(130%);
		transition:
			background-color 0.3s ease,
			border-color 0.3s ease,
			transform 0.2s ease;
		display: flex;
		flex-direction: column;
		max-height: 90vh;
	}

	/* Adjust modal surface per color scheme for legibility */
	:global([data-theme='dark']) .modal-content {
		background: rgba(6, 12, 18, 0.78);
		border: 1px solid rgba(255, 255, 255, 0.06);
	}
	:global([data-theme='light']) .modal-content {
		background: rgba(255, 255, 255, 0.95);
		border: 1px solid rgba(0, 0, 0, 0.06);
	}

	.modal-content-wide {
		min-width: 600px;
		max-width: 800px;
	}

	.modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 1rem;
		flex-shrink: 0;
	}

	.modal-title {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		font-size: 1.25rem;
		font-weight: 600;
		margin: 0;
		color: var(--text-primary);
	}

	.close-btn {
		background: transparent;
		border: none;
		color: var(--text-secondary);
		cursor: pointer;
		padding: 0.25rem;
		border-radius: 6px;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.2s;
	}

	.close-btn:hover {
		background: var(--bg-tertiary);
		color: var(--text-primary);
	}

	.modal-body {
		margin-bottom: 1.5rem;
		color: var(--text-secondary);
		overflow-y: auto;
		flex: 1;
		min-height: 0;
	}

	.modal-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.75rem;
		flex-shrink: 0;
	}

	.btn-primary,
	.btn-secondary {
		padding: 0.5rem 1rem;
		border-radius: 0.5rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s;
		border: none;
	}

	.btn-primary {
		background: var(--accent);
		color: white;
	}

	.btn-primary:hover:not(:disabled) {
		background: var(--accent-hover);
	}

	.btn-secondary {
		background: var(--bg-tertiary);
		color: var(--text-primary);
	}

	.btn-secondary:hover:not(:disabled) {
		background: var(--bg-quaternary);
	}

	.btn-primary:disabled,
	.btn-secondary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	@media (max-width: 640px) {
		.modal-content,
		.modal-content-wide {
			min-width: auto;
			width: 90vw;
		}
	}
</style>
