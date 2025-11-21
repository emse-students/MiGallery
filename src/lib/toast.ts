import { writable } from 'svelte/store';

export interface ToastMessage {
	id: string;
	message: string;
	type: 'info' | 'success' | 'error' | 'warning';
	duration?: number;
}

function createToastStore() {
	const { subscribe, update } = writable<ToastMessage[]>([]);

	return {
		subscribe,
		show(message: string, type: ToastMessage['type'] = 'info', duration = 3000) {
			const id = Math.random().toString(36).substring(7);
			update((toasts) => [...toasts, { id, message, type, duration }]);
			return id;
		},
		success(message: string, duration = 3000) {
			return this.show(message, 'success', duration);
		},
		error(message: string, duration = 5000) {
			return this.show(message, 'error', duration);
		},
		warning(message: string, duration = 4000) {
			return this.show(message, 'warning', duration);
		},
		info(message: string, duration = 3000) {
			return this.show(message, 'info', duration);
		},
		dismiss(id: string) {
			update((toasts) => toasts.filter((t) => t.id !== id));
		},
		clear() {
			update(() => []);
		}
	};
}

export const toast = createToastStore();
