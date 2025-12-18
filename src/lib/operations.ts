import { writable } from 'svelte/store';

/**
 * Store pour gérer les opérations en cours (uploads, etc.)
 * Permet d'avertir l'utilisateur avant de quitter la page
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
 * Ajouter un listener beforeunload pour avertir avant fermeture/rafraîchissement
 */
if (typeof window !== 'undefined') {
	let currentOperations = new Set<string>();

	activeOperations.subscribe((ops) => {
		currentOperations = new Set(ops);
	});

	window.addEventListener('beforeunload', (e) => {
		if (currentOperations.size > 0) {
			e.preventDefault();
			e.returnValue = 'Des opérations sont en cours. Êtes-vous sûr de vouloir quitter ?';
			return 'Des opérations sont en cours. Êtes-vous sûr de vouloir quitter ?';
		}
	});
}
