import { writable } from 'svelte/store';

/**
 * Store pour gérer le modal de confirmation de navigation
 */
export const navigationModalStore = writable<{
	show: boolean;
	href?: string;
} | null>(null);
