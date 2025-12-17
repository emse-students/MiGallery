<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from "$app/state";
	import { signIn, signOut } from "@auth/sveltekit/client";
	import { activeOperations } from "$lib/operations";
	import { navigationModalStore } from "$lib/navigation-store";
	import { theme } from "$lib/theme";
	import type { User } from "$lib/types/api";
	import Icon from "$lib/components/Icon.svelte";
	import ToastContainer from "$lib/components/ToastContainer.svelte";
	import Modal from "$lib/components/Modal.svelte";
	import ConfirmHost from '$lib/components/ConfirmHost.svelte';
	import MobileNav from '$lib/components/MobileNav.svelte';
	import FirstLoginModal from '$lib/components/FirstLoginModal.svelte';
	import "../app.css";

	let u = $derived((page.data?.session?.user) as User);
	let isAdmin = $derived(u?.role === 'admin');
	let isMitviste = $derived(u?.role === 'mitviste');
	let canManagePhotos = $derived(isAdmin || isMitviste);
	let hasPhoto = $derived(!!u?.id_photos);
	let isAuthenticated = $derived(!!u);
	let isHomePage = $derived(page.url.pathname === '/');
	let isFirstLogin = $derived(u?.first_login === 1);

	let { children } = $props();

	// Modal première connexion
	let showFirstLoginModal = $state(false);

	// Initialiser le thème au montage
	onMount(() => {
		theme.initialize();

		// Afficher le modal si première connexion
		if (isFirstLogin) {
			showFirstLoginModal = true;
		}
	});

	// Détecter changement de first_login après update
	$effect(() => {
		if (isFirstLogin && isAuthenticated && !showFirstLoginModal) {
			showFirstLoginModal = true;
		}
	});

	function handleFirstLoginComplete() {
		// Recharger la page pour mettre à jour la session
		window.location.reload();
	}

	// Avertissement avant navigation pendant une opération
	let navigationModal = $derived($navigationModalStore);
	let showNavigationWarning = $derived.by(() => navigationModal?.show ?? false);

	function confirmNavigation() {
		if (navigationModal?.href) {
			activeOperations.clear();
			const href = navigationModal.href;
			navigationModalStore.set(null);
			// La navigation se fera via window.location.href
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

		await signOut({ callbackUrl: '/' });
	}

	async function handleSignIn() {
		// signIn() gère automatiquement la mécanique CSRF/cookies/redirections
		// Sans callbackUrl, redirige vers la page d'origine après authentification
		await signIn('cas-emse', { callbackUrl: window.location.href });
	}
</script>

<svelte:head>
	<link rel="icon" type="image/png" sizes="32x32" href="/icon.png">
	<meta name="description" content="MiGallery - Galerie photo des étudiants EMSE">
	<meta name="theme-color" content="#3b82f6">
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
					<Icon name="folder" size={18} />
					<span class="link-text">Albums</span>
				</a>
				{#if hasPhoto}
					<a href="/mes-photos" data-sveltekit-preload-data>
						<Icon name="user" size={18} />
						<span class="link-text">Mes photos</span>
					</a>
				{/if}
				{#if hasPhoto || canManagePhotos}
					<a href="/photos-cv" data-sveltekit-preload-data>
						<Icon name="camera" size={18} />
						<span class="link-text">Photos CV</span>
					</a>
				{/if}
			</div>

			<div class="links-right">
				{#if isAdmin}
					<a href="/trombinoscope">
						<Icon name="users" size={18} />
						<span class="link-text">Trombinoscope</span>
					</a>
				{/if}
				{#if canManagePhotos}
					<a href="/corbeille">
						<Icon name="trash" size={18} />
						<span class="link-text">Corbeille</span>
					</a>
				{/if}
				<a href="/parametres">
					<Icon name="settings" size={18} />
					<span class="link-text">Paramètres</span>
				</a>
			</div>
		{/if}
	</div>

	<div class="nav-separator"></div>

	<div class="user">
		{#if u}
			<a href="/mes-photos" class="avatar-link">
				<div class="avatar" title={`${u.prenom || ''} ${u.nom || ''}`}>
					{#if u.id_photos}
						<img src={`/api/immich/people/${u.id_photos}/thumbnail`} alt="avatar" onerror={(e) => (e.currentTarget as HTMLImageElement).style.display = 'none'} />
					{:else}
						<span class="initials">{(u.prenom || 'U').charAt(0)}{(u.nom || '').charAt(0) || 'U'}</span>
					{/if}
				</div>
			</a>
			<span class="user-name">{u.prenom} {u.nom}</span>
			<button class="btn-logout" onclick={() => handleSignOut()}>Déconnexion</button>
		{:else}
			<button class="btn-login" onclick={() => handleSignIn()}>Connexion</button>
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
	title="Opération en cours"
	type="warning"
	confirmText="Quitter quand même"
	cancelText="Continuer l'opération"
	onConfirm={confirmNavigation}
	onCancel={cancelNavigation}
>
	{#snippet children()}
		<p>Des opérations sont en cours (uploads, suppressions, etc.).</p>
		<p>Si vous quittez maintenant, ces opérations seront annulées.</p>
		<p><strong>Voulez-vous vraiment quitter ?</strong></p>
	{/snippet}
</Modal>
