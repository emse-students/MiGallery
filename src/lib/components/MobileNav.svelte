<!--
  MobileNav.svelte - Fixed bottom navigation bar on mobile

  Shows a native-app-like navigation bar at the bottom of the screen on mobile.
  It automatically handles conditional display per user permissions, the active
  page indication, and the tap transition. Included in the root layout.
-->
<script lang="ts">
	import { page } from '$app/state';
	import { Folder, User as UserIcon, Camera, Settings } from 'lucide-svelte';
	import type { User } from '$lib/types/api';
	import { m } from '$lib/paraglide/messages';

	let user = $derived(page.data?.session?.user as User | undefined);
	let isAuthenticated = $derived(!!user);

	let currentPath = $derived(page.url.pathname);

	let isAlbumDetailPage = $derived(currentPath.startsWith('/albums/') && currentPath !== '/albums/');

	/**
	 * Whether a nav link is active.
	 * @param href - the link path
	 * @param exact - if true, require an exact match
	 */
	function isActive(href: string, exact = false): boolean {
		if (exact) return currentPath === href;
		return currentPath.startsWith(href);
	}
</script>

{#if isAuthenticated && !isAlbumDetailPage}
	<nav class="mobile-nav" aria-label={m.nav_mobile_aria()}>
		<a href="/albums" class="nav-item" class:active={isActive('/albums')} data-sveltekit-preload-data>
			<Folder size={24} />
			<span class="nav-label">{m.nav_albums()}</span>
		</a>

		<a
			href="/mes-photos"
			class="nav-item"
			class:active={isActive('/mes-photos')}
			data-sveltekit-preload-data
		>
			<UserIcon size={24} />
			<span class="nav-label">{m.nav_my_photos()}</span>
		</a>

		<a
			href="/photos-cv"
			class="nav-item"
			class:active={isActive('/photos-cv')}
			data-sveltekit-preload-data
		>
			<Camera size={24} />
			<span class="nav-label">{m.nav_photos_cv()}</span>
		</a>

		<a
			href="/parametres"
			class="nav-item"
			class:active={isActive('/parametres')}
			data-sveltekit-preload-data
		>
			<Settings size={24} />
			<span class="nav-label">{m.nav_settings()}</span>
		</a>
	</nav>
{/if}

<style>
	.mobile-nav {
		display: none; /* Hidden by default on desktop */
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		width: 100%;
		background: var(--bg-secondary);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		border-top: 1px solid var(--border);
		padding: 0.5rem 0;
		padding-bottom: calc(0.5rem + env(safe-area-inset-bottom, 0px)); /* iPhone notch support */
		z-index: 1000;
		box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.15);
	}

	@media (max-width: 1440px) {
		.mobile-nav {
			display: flex;
			justify-content: space-around;
			align-items: center;
		}
	}

	.nav-item {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.25rem;
		padding: 0.5rem 0.75rem;
		color: var(--text-muted);
		text-decoration: none;
		border-radius: var(--radius-sm);
		transition: all 0.2s ease;
		min-width: 60px;
	}

	.nav-item:hover {
		color: var(--text-secondary);
	}

	.nav-item.active {
		color: var(--accent);
	}

	.nav-label {
		font-size: 0.625rem;
		font-weight: 500;
		letter-spacing: 0.01em;
		text-align: center;
	}

	/* Tap animation */
	.nav-item:active {
		transform: scale(0.95);
	}
</style>
