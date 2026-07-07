<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { activeOperations } from '$lib/operations';
	import { navigationModalStore } from '$lib/navigation-store';
	import { theme } from '$lib/theme';
	import type { User } from '$lib/types/api';
	import {
		Folder,
		User as UserIcon,
		Camera,
		Users,
		Trash2,
		Settings,
		Shield,
		LogIn
	} from 'lucide-svelte';
	import ToastContainer from '$lib/components/ToastContainer.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import ConfirmHost from '$lib/components/ConfirmHost.svelte';
	import MobileNav from '$lib/components/MobileNav.svelte';
	import FirstLoginModal from '$lib/components/FirstLoginModal.svelte';
	import LocaleSwitcher from '$lib/components/LocaleSwitcher.svelte';
	import { m } from '$lib/paraglide/messages';
	import '../app.css';

	let u = $derived(page.data?.session?.user as User);
	let isAdmin = $derived(u?.role === 'admin');
	let isMitviste = $derived(u?.role === 'mitviste');
	let canManagePhotos = $derived(isAdmin || isMitviste);
	let hasPhoto = $derived(!!u?.id_photos);
	let isAuthenticated = $derived(!!u);
	let isHomePage = $derived(page.url.pathname === '/');
	let isFirstLogin = $derived(u?.first_login === 1);

	let { children } = $props();

	let showFirstLoginModal = $state(false);

	onMount(() => {
		theme.initialize();

		if (isFirstLogin) {
			showFirstLoginModal = true;
		}
	});

	$effect(() => {
		if (isFirstLogin && isAuthenticated && !showFirstLoginModal) {
			showFirstLoginModal = true;
		}
	});

	function handleFirstLoginComplete() {
		window.location.reload();
	}

	let navigationModal = $derived($navigationModalStore);
	let showNavigationWarning = $derived.by(() => navigationModal?.show ?? false);

	function confirmNavigation() {
		if (navigationModal?.href) {
			activeOperations.clear();
			const href = navigationModal.href;
			navigationModalStore.set(null);
			window.location.href = href;
		}
	}

	function cancelNavigation() {
		navigationModalStore.set(null);
	}

	async function handleSignOut() {
		try {
			await fetch('/api/change-user', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ userId: null })
			});
		} catch (e: unknown) {
			console.warn('Failed to clear user cookie:', e);
		}

		try {
			await fetch('/api/auth/logout', {
				method: 'POST'
			});
		} catch (e: unknown) {
			console.warn('Failed to call /api/auth/logout:', e);
		}

		window.location.href = '/';
	}

	function handleSignIn() {
		window.location.href = '/api/auth/login';
	}
</script>

<svelte:head>
	<link rel="icon" type="image/png" sizes="32x32" href="/icon.png" />
	<meta name="description" content={m.app_meta_description()} />
	<meta name="theme-color" content="#3b82f6" />
	<title>MiGallery</title>
</svelte:head>

<nav class="topbar">
	<div class="brand">
		<img src="/icon.png" alt="MiGallery" class="logo" fetchpriority="high" />
		<a href="/">MiGallery</a>
	</div>

	<div class="links">
		{#if isAuthenticated}
			<div class="links-left">
				<a href="/albums" data-sveltekit-preload-data>
					<Folder size={18} />
					<span class="link-text">{m.nav_albums()}</span>
				</a>
				{#if hasPhoto}
					<a href="/mes-photos" data-sveltekit-preload-data>
						<UserIcon size={18} />
						<span class="link-text">{m.nav_my_photos()}</span>
					</a>
				{/if}
				{#if hasPhoto || canManagePhotos}
					<a href="/photos-cv" data-sveltekit-preload-data>
						<Camera size={18} />
						<span class="link-text">{m.nav_photos_cv()}</span>
					</a>
				{/if}
			</div>

			<div class="links-right">
				{#if isAdmin}
					<a href="/trombinoscope">
						<Users size={18} />
						<span class="link-text">{m.nav_trombinoscope()}</span>
					</a>
				{/if}
				{#if canManagePhotos}
					<a href="/corbeille">
						<Trash2 size={18} />
						<span class="link-text">{m.nav_trash()}</span>
					</a>
				{/if}
				<a href="/parametres">
					<Settings size={18} />
					<span class="link-text">{m.nav_settings()}</span>
				</a>
				{#if isAdmin}
					<a href="/admin">
						<Shield size={18} />
						<span class="link-text">{m.nav_admin()}</span>
					</a>
				{/if}
			</div>
		{/if}
	</div>

	<div class="nav-separator"></div>

	<div class="user">
		{#if u}
			<a href="/mes-photos" class="avatar-link">
				<div class="avatar" title={u.name || `${u.first_name || ''} ${u.last_name || ''}`.trim()}>
					{#if u.id_photos}
						<img
							src={`/api/immich/people/${u.id_photos}/thumbnail`}
							alt="avatar"
							onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')}
						/>
					{:else}
						<span class="initials">{(u.first_name || 'U').charAt(0)}{(u.last_name || '').charAt(0) || 'U'}</span>
					{/if}
				</div>
			</a>
			<span class="user-name">{u.name}</span>
			<LocaleSwitcher />
			<button class="btn-logout" onclick={() => handleSignOut()}>{m.nav_logout()}</button>
		{:else}
			<LocaleSwitcher />
			<button class="btn-login" onclick={() => handleSignIn()}>{m.nav_login()}</button>
		{/if}
	</div>
</nav>

<main>
	{@render children()}
</main>

<ToastContainer />

<ConfirmHost />

<MobileNav />

<FirstLoginModal bind:show={showFirstLoginModal} onComplete={handleFirstLoginComplete} />

<Modal
	bind:show={showNavigationWarning}
	title={m.nav_op_title()}
	type="warning"
	confirmText={m.nav_op_leave_anyway()}
	cancelText={m.nav_op_continue()}
	onConfirm={confirmNavigation}
	onCancel={cancelNavigation}
>
	{#snippet children()}
		<p>{m.nav_op_body_running()}</p>
		<p>{m.nav_op_body_cancelled()}</p>
		<p><strong>{m.nav_op_body_confirm()}</strong></p>
	{/snippet}
</Modal>



<style>
</style>
