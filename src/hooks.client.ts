import { activeOperations } from '$lib/operations';
import { navigationModalStore } from '$lib/navigation-store';

/**
 * Intercept clicks on links to block navigation
 * if operations are in progress
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
	); // Capture phase = before SvelteKit
}

// StreamSaver was removed in favour of server-side download tokens. Proactively
// unregister any lingering service worker left over from the old download flow -
// the script no longer exists, so a stale registration would otherwise persist.
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
	navigator.serviceWorker.getRegistrations().then((regs) => {
		for (const reg of regs) {
			const url = reg.active?.scriptURL ?? reg.waiting?.scriptURL ?? reg.installing?.scriptURL;
			if (url?.includes('streamsaver-sw')) {
				reg.unregister();
			}
		}
	});
}
