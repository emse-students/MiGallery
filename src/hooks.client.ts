import { activeOperations } from '$lib/operations';
import { navigationModalStore } from '$lib/navigation-store';

/**
 * Intercepter les clics sur les liens pour blocker la navigation
 * si des opérations sont en cours
 */
if (typeof window !== 'undefined') {
	let hasActiveOps = false;

	activeOperations.subscribe((ops) => {
		hasActiveOps = ops.size > 0;
		console.warn('[hooks.client] Active operations updated:', ops.size);
	});

	// Utiliser la capture phase pour intercepter AVANT SvelteKit
	document.addEventListener(
		'click',
		(e) => {
			const target = e.target as HTMLElement;
			const link = target.closest('a[href]') as HTMLAnchorElement | null;

			if (!link) {
				return;
			}

			// Vérifier si c'est un lien interne
			const href = link.getAttribute('href');
			// Ignorer les liens externes, les blobs (téléchargements) et les nouveaux onglets
			if (
				!href ||
				href.startsWith('http') ||
				href.startsWith('blob:') ||
				link.getAttribute('target') === '_blank' ||
				link.hasAttribute('download')
			) {
				return;
			}

			// Si des opérations sont en cours, bloquer la navigation
			if (hasActiveOps) {
				console.warn('[hooks.client] Blocking navigation to:', href);
				e.preventDefault();
				e.stopPropagation();
				// Afficher le modal au lieu d'utiliser confirm()
				navigationModalStore.set({
					show: true,
					href
				});
				return;
			}
		},
		true
	); // Capture phase = avant SvelteKit
}
