<script lang="ts">
	import { onMount } from 'svelte';
	import { Info, CheckCircle, XCircle, AlertTriangle, X } from 'lucide-svelte';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		message: string;
		type?: 'info' | 'success' | 'error' | 'warning';
		duration?: number;
		onClose?: () => void;
	}

	let { message, type = 'info', duration = 3000, onClose }: Props = $props();

	let visible = $state(true);

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const iconMap: Record<string, any> = {
		info: Info,
		success: CheckCircle,
		error: XCircle,
		warning: AlertTriangle
	};

	const ToastIcon = $derived(iconMap[type] ?? Info);

	onMount(() => {
		if (duration > 0) {
			const timer = setTimeout(() => {
				visible = false;
				setTimeout(() => {
					if (onClose) onClose();
				}, 300);
			}, duration);

			return () => clearTimeout(timer);
		}
	});

	function handleClose() {
		visible = false;
		setTimeout(() => {
			if (onClose) onClose();
		}, 300);
	}
</script>

<div class="toast toast-{type}" class:visible>
	<ToastIcon size={20} />
	<span class="toast-message">{message}</span>
	<button type="button" class="toast-close" onclick={handleClose} aria-label={m.common_close()}>
		<X size={16} />
	</button>
</div>

<style>
	.toast {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
		border-radius: var(--radius-sm);
		box-shadow: var(--shadow-lg);
		color: #fff;
		min-width: 300px;
		max-width: 500px;
		opacity: 0;
		transform: translateY(-1rem);
		transition: all 0.3s ease;
		pointer-events: all;
	}

	.toast-info {
		background: var(--info);
	}
	.toast-success {
		background: var(--success);
	}
	.toast-error {
		background: var(--error);
	}
	.toast-warning {
		background: var(--warning);
	}

	.toast.visible {
		opacity: 1;
		transform: translateY(0);
	}

	.toast-message {
		flex: 1;
		font-size: 0.875rem;
		font-weight: 500;
	}

	.toast-close {
		background: none;
		border: none;
		cursor: pointer;
		padding: 0.25rem;
		display: flex;
		align-items: center;
		justify-content: center;
		opacity: 0.8;
		transition: opacity 0.2s;
	}

	.toast-close:hover {
		opacity: 1;
	}
</style>
