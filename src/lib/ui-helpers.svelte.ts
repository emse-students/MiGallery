/**
 * Helpers pour gérer les modals et toasts de manière simple
 */

import { toast as toastStore } from './toast';

/**
 * Afficher un message de succès
 */
export function showSuccess(message: string, duration: number = 3000) {
	toastStore.success(message, duration);
}

/**
 * Afficher un message d'erreur
 */
export function showError(message: string, duration = 5000) {
	toastStore.error(message, duration);
}

/**
 * Afficher un message d'information
 */
export function showInfo(message: string, duration = 3000) {
	toastStore.info(message, duration);
}

/**
 * Afficher un avertissement
 */
export function showWarning(message: string, duration = 4000) {
	toastStore.warning(message, duration);
}

/**
 * Wrapper pour remplacer les alert() par des toasts
 */
export function showMessage(message: string) {
	toastStore.info(message);
}

/**
 * État pour gérer les modals de confirmation
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
			title = 'Confirmation',
			confirmText = 'Confirmer',
			cancelText = 'Annuler'
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
