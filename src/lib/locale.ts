import { setLocale, type Locale } from '$lib/paraglide/runtime';

/**
 * Switch the UI language. First records the choice against the logged-in user's
 * profile (so it follows the account across devices), then hands off to
 * Paraglide's setLocale, which writes the PARAGLIDE_LOCALE cookie and reloads
 * the page. The persistence call is best-effort: if it fails (e.g. a logged-out
 * visitor, or a network error), the cookie-based switch below still applies.
 */
export async function switchLocale(value: Locale): Promise<void> {
	try {
		await fetch('/api/users/me/locale', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ locale: value })
		});
	} catch {
		// Ignore: the cookie-based switch below still works for logged-out users.
	}
	setLocale(value);
}
