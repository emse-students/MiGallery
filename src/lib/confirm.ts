import { writable } from 'svelte/store';

type ConfirmState = {
	show: boolean;
	title?: string;
	message?: string;
	confirmText?: string;
	cancelText?: string;
	resolve?: (v: boolean) => void;
};

const defaultState: ConfirmState = { show: false };

const { subscribe, set, update } = writable<ConfirmState>(defaultState);

export const confirmStore = { subscribe };

export function showConfirm(
	message: string,
	title = 'Confirmation',
	confirmText = 'Confirmer',
	cancelText = 'Annuler'
): Promise<boolean> {
	return new Promise((resolve) => {
		set({ show: true, title, message, confirmText, cancelText, resolve });
	});
}

export function resolveConfirm(value: boolean) {
	update((s) => {
		s.resolve?.(value);
		return { show: false };
	});
}
