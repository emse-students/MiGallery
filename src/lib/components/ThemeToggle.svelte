<script lang="ts">
  /**
   * Round light/dark switch for the top bar, signed-out only.
   *
   * It shows the theme it would switch TO, not the one in force: the icon is the promise of what
   * the click does, which is the only thing a reader needs from a control they are about to press.
   */
  import { Moon, Sun } from '@lucide/svelte';
  import { theme } from '$lib/theme';
  import { m } from '$lib/paraglide/messages';
</script>

<button
  type="button"
  class="nav-toggle"
  onclick={() => theme.toggle()}
  aria-label={m.nav_theme_toggle()}
  title={m.nav_theme_toggle()}
>
  {#if $theme === 'dark'}
    <Sun size={18} />
  {:else}
    <Moon size={18} />
  {/if}
</button>
