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
				console.debug(`[Operations] Start: ${operationId}, total:`, newOps.size);
				return newOps;
			});
		},
		end(operationId: string) {
			update((ops) => {
				// Créer une nouvelle instance pour assurer la réactivité
				const newOps = new Set(ops);
				newOps.delete(operationId);
				console.debug(`[Operations] End: ${operationId}, total:`, newOps.size);
				return newOps;
			});
		},
		clear() {
			update(() => {
				console.debug('[Operations] Clear all');
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
		console.debug('[beforeunload] Operations updated:', currentOperations.size);
	});

	window.addEventListener('beforeunload', (e) => {
		if (currentOperations.size > 0) {
			console.warn('[beforeunload] Blocking navigation, active operations:', currentOperations.size);
			e.preventDefault();
			// Ces deux lignes doivent être présentes pour bloquer la navigation
			e.returnValue = 'Des opérations sont en cours. Êtes-vous sûr de vouloir quitter ?';
			// Certains navigateurs anciens nécessitent un return
			return 'Des opérations sont en cours. Êtes-vous sûr de vouloir quitter ?';
		}
	});
}
