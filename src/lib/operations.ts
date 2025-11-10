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
      update(ops => {
        ops.add(operationId);
        return ops;
      });
    },
    end(operationId: string) {
      update(ops => {
        ops.delete(operationId);
        return ops;
      });
    },
    clear() {
      update(() => new Set());
    },
    hasActiveOperations: (ops: Set<string>) => ops.size > 0
  };
}

export const activeOperations = createOperationsStore();

/**
 * Ajouter un listener beforeunload pour avertir avant fermeture/rafraîchissement
 */
if (typeof window !== 'undefined') {
  let currentOperations = new Set<string>();
  
  activeOperations.subscribe(ops => {
    currentOperations = ops;
  });

  window.addEventListener('beforeunload', (e) => {
    if (currentOperations.size > 0) {
      e.preventDefault();
      e.returnValue = 'Des opérations sont en cours. Êtes-vous sûr de vouloir quitter ?';
      return e.returnValue;
    }
  });
}
