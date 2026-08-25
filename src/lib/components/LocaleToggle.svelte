<script lang="ts">
	/**
	 * Round language switch for the top bar, signed-out only.
	 *
	 * A toggle rather than the <select> that stood here before: with two locales a menu costs two
	 * interactions to answer a question one tap settles. It is written as a cycle over `locales`
	 * so adding a third needs no change here - only the label stops reading as a binary.
	 */
	import { getLocale, locales, type Locale } from '$lib/paraglide/runtime';
	import { switchLocale } from '$lib/locale';
	import { m } from '$lib/paraglide/messages';

	/** The locale one click away. */
	function nextLocale(): Locale {
		const current = getLocale();
		return locales[(locales.indexOf(current) + 1) % locales.length];
	}
</script>

<button
	type="button"
	class="nav-toggle"
	onclick={() => switchLocale(nextLocale())}
	aria-label={m.nav_language_toggle()}
	title={m.nav_language_toggle()}
>
	{getLocale()}
</button>
