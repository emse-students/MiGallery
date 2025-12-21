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

	document.addEventListener(
		'click',
		(e) => {
			const target = e.target as HTMLElement;
			const link = target.closest('a[href]') as HTMLAnchorElement | null;

			if (!link) {
				return;
			}

			const href = link.getAttribute('href');
			if (
				!href ||
				href.startsWith('http') ||
				href.startsWith('blob:') ||
				link.getAttribute('target') === '_blank' ||
				link.hasAttribute('download')
			) {
				return;
			}

			if (hasActiveOps) {
				console.warn('[hooks.client] Blocking navigation to:', href);
				e.preventDefault();
				e.stopPropagation();
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

// Enregistrer un service worker léger pour StreamSaver (si disponible)
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
	navigator.serviceWorker
		.register('/streamsaver-sw.js')
		.then((reg) => {
			console.debug('[hooks.client] streamsaver service worker registered', reg.scope);
		})
		.catch((err) => {
			console.warn('[hooks.client] failed to register streamsaver service worker', err);
		});
}
