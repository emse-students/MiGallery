import { writable } from 'svelte/store';

/**
 * Store to manage the navigation confirmation modal
 */
export const navigationModalStore = writable<{
	show: boolean;
	href?: string;
} | null>(null);
