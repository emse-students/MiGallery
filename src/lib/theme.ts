import { writable } from 'svelte/store';
import { browser } from '$app/environment';

export type Theme = 'light' | 'dark';

function createThemeStore() {
	const stored = browser ? localStorage.getItem('theme') : null;
	const initial: Theme = (stored as Theme) || 'dark';

	const { subscribe, set, update } = writable<Theme>(initial);

	return {
		subscribe,
		set: (theme: Theme) => {
			if (browser) {
				localStorage.setItem('theme', theme);
				document.documentElement.setAttribute('data-theme', theme);
			}
			set(theme);
		},
		toggle: () => {
			update((current) => {
				const next = current === 'light' ? 'dark' : 'light';
				if (browser) {
					localStorage.setItem('theme', next);
					document.documentElement.setAttribute('data-theme', next);
				}
				return next;
			});
		},
		initialize: () => {
			if (browser) {
				document.documentElement.setAttribute('data-theme', initial);
			}
		}
	};
}

export const theme = createThemeStore();
