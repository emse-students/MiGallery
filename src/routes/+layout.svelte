<script lang="ts">
	import { page } from "$app/state";
	import { beforeNavigate } from "$app/navigation";
	import { signIn, signOut } from "@auth/sveltekit/client";
	import { activeOperations } from "$lib/operations";
	import ToastContainer from "$lib/components/ToastContainer.svelte";
	import Modal from "$lib/components/Modal.svelte";
	import "../app.css";

	let u = $derived((page.data?.session?.user) as any);
	let isAdmin = $derived(u?.role === 'admin');
	let isMitviste = $derived(u?.role === 'mitviste');
	let canManagePhotos = $derived(isAdmin || isMitviste);
	let hasPhoto = $derived(!!u?.id_photos);
	let isAuthenticated = $derived(!!u);
	let isHomePage = $derived(page.url.pathname === '/');
	
	let { children } = $props();

	// Avertissement avant navigation pendant une opération
	let showNavigationWarning = $state(false);

	beforeNavigate(() => {
		// Juste afficher un avertissement si des opérations sont en cours
		// Le vrai blocage se fait via beforeunload dans operations.ts
		if ($activeOperations.size > 0) {
			showNavigationWarning = true;
		}
	});

	function confirmNavigation() {
		activeOperations.clear();
		showNavigationWarning = false;
		// La navigation se fera automatiquement si l'utilisateur clique sur un lien à nouveau
	}

	function cancelNavigation() {
		showNavigationWarning = false;
	}
	
	async function handleSignOut() {
		// Clear the signed cookie before calling signOut
		await fetch('/api/change-user', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ userId: null })
		});
		await signOut();
	}
</script>

<svelte:head>
	<link rel="icon" type="image/png" sizes="32x32" href="/MiGallery.png">
	<meta name="description" content="MiGallery - Galerie photo des étudiants EMSE">
	<meta name="theme-color" content="#3b82f6">
	<title>MiGallery</title>
</svelte:head>

<nav class="topbar">
	<div class="brand">
		<img src="/MiGallery.png" alt="MiGallery" class="logo" />
		<a href="/">MiGallery</a>
	</div>

	<div class="links">
		{#if isAuthenticated}
			<div class="links-left">
				<a href="/albums">Albums</a>
				{#if hasPhoto}
					<a href="/mes-photos">Mes photos</a>
				{/if}
				{#if hasPhoto || canManagePhotos}
					<a href="/photos-cv">Photos CV</a>
				{/if}
			</div>
			
			<div class="links-right">
				{#if isAdmin}
					<a href="/trombinoscope">Trombinoscope</a>
				{/if}
				{#if canManagePhotos}
					<a href="/corbeille">Corbeille</a>
				{/if}
				<a href="/parametres">Paramètres</a>
			</div>
		{/if}
	</div>

	<div class="nav-separator"></div>

	<div class="user">
		{#if u}
			<div class="avatar" title={`${u.prenom || ''} ${u.nom || ''}`}>
				{#if u.id_photos}
					<img src={`/api/immich/people/${u.id_photos}/thumbnail`} alt="avatar" onerror={(e) => (e.currentTarget as HTMLImageElement).style.display = 'none'} />
				{:else}
					<span class="initials">{(u.prenom || 'U').charAt(0)}{(u.nom || '').charAt(0) || 'U'}</span>
				{/if}
			</div>
			<span class="user-name">{u.prenom} {u.nom}</span>
			<button class="btn-logout" onclick={handleSignOut}>Déconnexion</button>
		{:else}
			<button class="btn-login" onclick={() => signIn('cas-emse')}>Connexion</button>
		{/if}
	</div>
</nav>

<main>
	{@render children()}
</main>

<ToastContainer />

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

