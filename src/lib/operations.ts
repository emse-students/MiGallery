import { writable } from 'svelte/store';
import { m } from '$lib/paraglide/messages';

/**
 * Store to manage in-progress operations (uploads, etc.)
 * Allows warning the user before leaving the page
 */
function createOperationsStore() {
	const { subscribe, update } = writable<Set<string>>(new Set());

	return {
		subscribe,
		start(operationId: string) {
			update((ops) => {
				const newOps = new Set(ops);
				newOps.add(operationId);
				return newOps;
			});
		},
		end(operationId: string) {
			update((ops) => {
				const newOps = new Set(ops);
				newOps.delete(operationId);
				return newOps;
			});
		},
		clear() {
			update(() => {
				return new Set();
			});
		},
		hasActiveOperations(ops: Set<string>): boolean {
			return ops.size > 0;
		}
	};
}

export const activeOperations = createOperationsStore();

/**
 * Add a beforeunload listener to warn before closing/refreshing
 */
if (typeof window !== 'undefined') {
	let currentOperations = new Set<string>();

	activeOperations.subscribe((ops) => {
		currentOperations = new Set(ops);
	});

	window.addEventListener('beforeunload', (e) => {
		if (currentOperations.size > 0) {
			e.preventDefault();
			e.returnValue = m.op_beforeunload();
			return m.op_beforeunload();
		}
	});
}
