/**
 * Helpers to manage modals and toasts in a simple way
 */

import { toast as toastStore } from './toast';
import { m } from '$lib/paraglide/messages';

/**
 * Show a success message
 */
export function showSuccess(message: string, duration: number = 3000) {
	toastStore.success(message, duration);
}

/**
 * Show an error message
 */
export function showError(message: string, duration = 5000) {
	toastStore.error(message, duration);
}

/**
 * Show an info message
 */
export function showInfo(message: string, duration = 3000) {
	toastStore.info(message, duration);
}

/**
 * Show a warning
 */
export function showWarning(message: string, duration = 4000) {
	toastStore.warning(message, duration);
}

/**
 * Wrapper to replace alert() calls with toasts
 */
export function showMessage(message: string) {
	toastStore.info(message);
}

/**
 * State to manage confirmation modals
 */
export function createConfirmModal() {
	let showModal = $state(false);
	let config = $state<{
		title: string;
		message: string;
		confirmText?: string;
		cancelText?: string;
		resolve?: (value: boolean) => void;
	} | null>(null);

	return {
		get show() {
			return showModal;
		},
		set show(value: boolean) {
			showModal = value;
		},
		get config() {
			return config;
		},

		confirm(
			message: string,
			title = m.common_confirmation(),
			confirmText = m.common_confirm(),
			cancelText = m.common_cancel()
		): Promise<boolean> {
			return new Promise((resolve) => {
				config = {
					title,
					message,
					confirmText,
					cancelText,
					resolve
				};
				showModal = true;
			});
		},

		handleConfirm() {
			if (config?.resolve) {
				config.resolve(true);
			}
			showModal = false;
			config = null;
		},

		handleCancel() {
			if (config?.resolve) {
				config.resolve(false);
			}
			showModal = false;
			config = null;
		}
	};
}
