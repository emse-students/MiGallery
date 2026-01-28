<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { signIn, signOut } from '@auth/sveltekit/client';
	import { activeOperations } from '$lib/operations';
	import { navigationModalStore } from '$lib/navigation-store';
	import { theme } from '$lib/theme';
	import type { User } from '$lib/types/api';
	import { Folder, User as UserIcon, Camera, Users, Trash2, Settings, LogIn } from 'lucide-svelte';
	import ToastContainer from '$lib/components/ToastContainer.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import ConfirmHost from '$lib/components/ConfirmHost.svelte';
	import MobileNav from '$lib/components/MobileNav.svelte';
	import FirstLoginModal from '$lib/components/FirstLoginModal.svelte';
	import '../app.css';

	let u = $derived(page.data?.session?.user as User);
	let isAdmin = $derived(u?.role === 'admin');
	let isMitviste = $derived(u?.role === 'mitviste');
	let canManagePhotos = $derived(isAdmin || isMitviste);
	let hasPhoto = $derived(!!u?.id_photos);
	let isAuthenticated = $derived(!!u);
	let isHomePage = $derived(page.url.pathname === '/');
	let isFirstLogin = $derived(u?.first_login === 1);
	let alumniEnabled = $derived(page.data?.alumniEnabled ?? false);

	let { children } = $props();

	let showFirstLoginModal = $state(false);
	let showLoginModal = $state(false);

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

		await signOut({ callbackUrl: '/' });
	}

	async function handleSignIn() {
		showLoginModal = true;
	}

	async function performSignIn(providerId: string) {
		showLoginModal = false;
		// signIn() gère automatiquement la mécanique CSRF/cookies/redirections
		// Sans callbackUrl, redirige vers la page d'origine après authentification
		await signIn(providerId, { callbackUrl: window.location.href });
	}
</script>

<svelte:head>
	<link rel="icon" type="image/png" sizes="32x32" href="/icon.png" />
	<meta name="description" content="MiGallery - Galerie photo des étudiants EMSE" />
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
					<span class="link-text">Albums</span>
				</a>
				{#if hasPhoto}
					<a href="/mes-photos" data-sveltekit-preload-data>
						<UserIcon size={18} />
						<span class="link-text">Mes photos</span>
					</a>
				{/if}
				{#if hasPhoto || canManagePhotos}
					<a href="/photos-cv" data-sveltekit-preload-data>
						<Camera size={18} />
						<span class="link-text">Photos CV</span>
					</a>
				{/if}
			</div>

			<div class="links-right">
				{#if isAdmin}
					<a href="/trombinoscope">
						<Users size={18} />
						<span class="link-text">Trombinoscope</span>
					</a>
				{/if}
				{#if canManagePhotos}
					<a href="/corbeille">
						<Trash2 size={18} />
						<span class="link-text">Corbeille</span>
					</a>
				{/if}
				<a href="/parametres">
					<Settings size={18} />
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
						<img
							src={`/api/immich/people/${u.id_photos}/thumbnail`}
							alt="avatar"
							onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')}
						/>
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

<Modal
	bind:show={showLoginModal}
	title="Connexion"
	type="info"
	showActions={false}
>
	{#snippet children()}
		<div class="login-modal-content">
			<p>Veuillez choisir votre méthode de connexion :</p>

			<div class="login-choices">
				<button onclick={() => performSignIn('cas-emse')} class="btn btn-primary login-btn">
					<LogIn size={20} />
					<span>Connexion CAS (Étudiants/Staff)</span>
				</button>

				{#if alumniEnabled}
					<div class="separator">
						<span>OU</span>
					</div>

					<button onclick={() => performSignIn('mines-alumni')} class="btn btn-secondary login-btn">
						<LogIn size={20} />
						<span>Connexion Alumni</span>
					</button>
				{/if}
			</div>

			<div class="login-info">
				<small>
					Vous possédez un compte étudiant et un compte Alumni ?<br>
					Connectez-vous avec {#if alumniEnabled}l'un ou l'autre{:else}le CAS{/if}, la liaison se fera automatiquement si vos informations (Nom/Prénom/Promo) correspondent.
				</small>
			</div>
		</div>
	{/snippet}
</Modal>

<style>
	.login-modal-content {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		padding: 0.5rem 0;
	}

	.login-choices {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.login-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
		font-size: 1rem;
		font-weight: 500;
		width: 100%;
	}

	.separator {
		display: flex;
		align-items: center;
		text-align: center;
		color: #888;
		font-size: 0.8rem;
		margin: 0.25rem 0;
	}

	.separator::before,
	.separator::after {
		content: '';
		flex: 1;
		border-bottom: 1px solid #ddd;
	}

	.separator:not(:empty)::before {
		margin-right: .5em;
	}

	.separator:not(:empty)::after {
		margin-left: .5em;
	}

	/* Dark mode support for separator */
	:global(.dark) .separator::before,
	:global(.dark) .separator::after {
		border-color: #444;
	}

	.login-info {
		margin-top: 0.5rem;
		padding: 0.75rem;
		background-color: rgba(255, 255, 255, 0.05); /* very light background */
		border-radius: 0.5rem;
		color: #888;
		text-align: center;
		font-size: 0.85rem;
		line-height: 1.4;
	}
</style>
