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
				// Créer une nouvelle instance pour assurer la réactivité
				const newOps = new Set(ops);
				newOps.add(operationId);
				return newOps;
			});
		},
		end(operationId: string) {
			update((ops) => {
				// Créer une nouvelle instance pour assurer la réactivité
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
		currentOperations = new Set(ops); // Créer une copie pour éviter les problèmes de mutation
	});

	window.addEventListener('beforeunload', (e) => {
		if (currentOperations.size > 0) {
			e.preventDefault();
			// Ces deux lignes doivent être présentes pour bloquer la navigation
			e.returnValue = 'Des opérations sont en cours. Êtes-vous sûr de vouloir quitter ?';
			// Certains navigateurs anciens nécessitent un return
			return 'Des opérations sont en cours. Êtes-vous sûr de vouloir quitter ?';
		}
	});
}
