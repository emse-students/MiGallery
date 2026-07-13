<script lang="ts">
	import { Languages } from 'lucide-svelte';
	import { getLocale, type Locale } from '$lib/paraglide/runtime';
	import { switchLocale } from '$lib/locale';
	import { m } from '$lib/paraglide/messages';

	// switchLocale persists the choice to the user's profile, then Paraglide
	// writes the cookie and reloads so the server re-renders in the new language.
	function onChange(event: Event) {
		const value = (event.currentTarget as HTMLSelectElement).value as Locale;
		switchLocale(value);
	}
</script>

<label class="locale-switcher" title={m.lang_label()}>
	<Languages size={16} />
	<select value={getLocale()} onchange={onChange} aria-label={m.lang_label()}>
		<option value="fr">{m.lang_french()}</option>
		<option value="en">{m.lang_english()}</option>
	</select>
</label>

<style>
	.locale-switcher {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		color: inherit;
	}
	select {
		background: transparent;
		border: 1px solid rgba(128, 128, 128, 0.3);
		border-radius: var(--radius-xs);
		color: inherit;
		padding: 4px 8px;
		font-size: 13px;
		cursor: pointer;
	}
</style>
