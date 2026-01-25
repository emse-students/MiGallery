<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount, onDestroy } from 'svelte';
	import {
		User as UserIcon,
		Camera,
		Palette,
		Sun,
		Moon,
		ScanFace,
		Info,
		CheckCircle,
		AlertCircle,
		Share2,
		X,
		Users,
		ChevronRight,
		AlertTriangle
	} from 'lucide-svelte';
	import Modal from '$lib/components/Modal.svelte';
	import Spinner from '$lib/components/Spinner.svelte';
	import CameraInput from '$lib/components/CameraInput.svelte';
	import BackgroundBlobs from '$lib/components/BackgroundBlobs.svelte';
	import ChangePhotoModal from '$lib/components/ChangePhotoModal.svelte';
	import { PhotosState } from '$lib/photos.svelte';
	import { theme } from '$lib/theme';
	import { asApiResponse } from '$lib/ts-utils';
	import type { UserRow, Album, User } from '$lib/types/api';
	import { showConfirm } from '$lib/confirm';
	import { toast } from '$lib/toast';
	import { uploadFileChunked } from '$lib/album-operations';

	const photosState = new PhotosState();
	let showChangePhotoModal = $state(false);

	let isAdmin = $state<boolean>(false);

	let uploadStatus = $state<string>('');
	let assetId = $state<string | null>(null);
	let tagAssetId = $state<string>('');
	let tagOpStatus = $state<string>('');
	let assetDescription = $state<string>('');
	let personId = $state<string | null>(null);

	let isProcessing = $state<boolean>(false);
	let needsNewPhoto = $state<boolean>(false);
	let abortController: AbortController | null = null;

	let showDeleteAccountModal = $state<boolean>(false);
	let deleteConfirmText = $state<string>('');
	let isDeletingAccount = $state<boolean>(false);
	let showFaceAlreadyAssignedModal = $state<boolean>(false);

	let showUnlinkFaceModal = $state<boolean>(false);
	let isUnlinkingFace = $state<boolean>(false);
	let currentUserHasFace = $state<boolean>(false);

	interface PhotoPermission {
		authorized_id: string;
		authorized_prenom: string;
		authorized_nom: string;
		created_at: string;
	}
	interface SharedWithMe {
		owner_id: string;
		owner_prenom: string;
		owner_nom: string;
		created_at: string;
	}
	let photoPermissions = $state<PhotoPermission[]>([]);
	let sharedWithMe = $state<SharedWithMe[]>([]);
	let newAuthUserId = $state<string>('');
	let isAddingPermission = $state<boolean>(false);
	let isLoadingPermissions = $state<boolean>(false);
	let isLoadingSharedWithMe = $state<boolean>(false);

	$effect(() => {
		loadCurrentUserFaceStatus();
		loadPhotoPermissions();
		loadSharedWithMe();
		try {
			const u = page.data.session?.user as User | undefined;
			isAdmin = !!(u && u.role === 'admin');
		} catch {
			isAdmin = false;
		}
	});

	onDestroy(() => photosState.cleanup());

	async function handlePhotoSelected(assetId: string) {
		const u = page.data.session?.user as User | undefined;
		if (!u?.id_photos) {
			toast.error("Vous n'êtes pas lié à une personne Immich.");
			return;
		}

		const updateRes = await fetch(`/api/immich/people/${u.id_photos}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ featureFaceAssetId: assetId })
		});

		if (!updateRes.ok) {
			const txt = await updateRes.text().catch(() => updateRes.statusText);
			throw new Error(txt || 'Erreur lors de la mise à jour de la photo');
		}

		toast.success('Photo de profil mise à jour !');
		window.location.reload();
	}

	async function loadCurrentUserFaceStatus() {
		try {
			const response = await fetch('/api/users/me');
			const data = (await response.json()) as {
				success?: boolean;
				user?: { id_photos?: string | null };
			};
			if (data.success && data.user) {
				currentUserHasFace = !!data.user.id_photos;
				personId = data.user.id_photos ?? null;
			}
		} catch {
			/* Ignorer */
		}
	}

	async function loadPhotoPermissions() {
		isLoadingPermissions = true;
		try {
			const response = await fetch('/api/users/me/photo-access');
			const data = (await response.json()) as { success?: boolean; permissions?: PhotoPermission[] };
			if (data.success && data.permissions) {
				photoPermissions = data.permissions;
			}
		} catch {
			/* Ignorer */
		} finally {
			isLoadingPermissions = false;
		}
	}

	async function loadSharedWithMe() {
		isLoadingSharedWithMe = true;
		try {
			const response = await fetch('/api/users/me/photo-access/shared-with-me');
			const data = (await response.json()) as { success?: boolean; shared_by?: SharedWithMe[] };
			if (data.success && data.shared_by) {
				sharedWithMe = data.shared_by;
			}
		} catch {
			/* Ignorer */
		} finally {
			isLoadingSharedWithMe = false;
		}
	}

	async function addPhotoPermission() {
		if (!newAuthUserId.trim()) {
			toast.error('Veuillez entrer un identifiant utilisateur');
			return;
		}
		isAddingPermission = true;
		try {
			const response = await fetch('/api/users/me/photo-access', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ user_id: newAuthUserId.trim() })
			});
			const data = (await response.json()) as { success?: boolean; error?: string; message?: string };
			if (data.success) {
				toast.success(data.message || 'Autorisation ajoutée');
				newAuthUserId = '';
				await loadPhotoPermissions();
			} else {
				toast.error(data.error || "Erreur lors de l'ajout");
			}
		} catch (e) {
			toast.error(`Erreur: ${e instanceof Error ? e.message : 'Erreur inconnue'}`);
		} finally {
			isAddingPermission = false;
		}
	}

	async function revokePhotoPermission(userId: string) {
		try {
			const response = await fetch('/api/users/me/photo-access', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ user_id: userId })
			});
			const data = (await response.json()) as { success?: boolean; error?: string };
			if (data.success) {
				toast.success('Autorisation révoquée');
				await loadPhotoPermissions();
			} else {
				toast.error(data.error || 'Erreur lors de la révocation');
			}
		} catch (e) {
			toast.error(`Erreur: ${e instanceof Error ? e.message : 'Erreur inconnue'}`);
		}
	}

	async function unlinkMyFace() {
		isUnlinkingFace = true;
		try {
			const response = await fetch('/api/users/me/face', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ person_id: null })
			});
			const data = (await response.json()) as { success?: boolean; error?: string };
			if (data.success) {
				toast.success('Votre visage a été dissocié de votre compte.');
				showUnlinkFaceModal = false;
				currentUserHasFace = false;
				personId = null;
			} else {
				toast.error(`Erreur: ${data.error || 'Erreur inconnue'}`);
			}
		} catch (e) {
			toast.error(`Erreur: ${e instanceof Error ? e.message : 'Erreur inconnue'}`);
		} finally {
			isUnlinkingFace = false;
		}
	}

	async function checkForPeople(
		shouldDeleteAfter: boolean = false,
		assetIdToDelete: string | null = null
	) {
		const userId = (page.data.session?.user as User)?.id_user;
		if (!userId || !assetId) return;
		let shouldCleanup = shouldDeleteAfter && assetIdToDelete;

		try {
			uploadStatus = 'Récupération des personnes détectées...';
			const assetInfoResponse = await fetch(`/api/immich/assets/${assetId}`);
			if (!assetInfoResponse.ok)
				throw new Error(`Erreur récupération asset: ${assetInfoResponse.statusText}`);
			const assetInfoData = await assetInfoResponse.json();
			const assetInfo = assetInfoData as { people?: Array<{ id: string }> };
			const people = assetInfo.people || [];

			uploadStatus = `${people.length} personne(s) détectée(s)`;

			if (people.length === 1) {
				personId = people[0].id;
				uploadStatus = `Visage détecté, enregistrement...`;

				const updateResponse = await fetch('/api/users/me/face', {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ person_id: personId })
				});
				const updateData = (await updateResponse.json()) as {
					success?: boolean;
					error?: string;
					message?: string;
				};

				if (updateData.error === 'face_already_assigned') {
					uploadStatus = 'Ce visage est déjà associé à un autre compte.';
					showFaceAlreadyAssignedModal = true;
					if (shouldCleanup) await cleanupAsset(assetIdToDelete);
					return;
				}

				if (updateData.success) {
					uploadStatus = `Visage reconnu avec succès !`;
					if (shouldCleanup) await cleanupAsset(assetIdToDelete);
					isProcessing = false;
					setTimeout(() => {
						window.location.href = window.location.href;
					}, 100);
				} else {
					uploadStatus = `Erreur mise à jour BDD: ${updateData.error || 'Erreur inconnue'}`;
				}
			} else if (people.length === 0) {
				uploadStatus = 'Aucun visage détecté. Veuillez utiliser une photo claire.';
				if (shouldCleanup) await cleanupAsset(assetIdToDelete);
			} else {
				uploadStatus = `${people.length} visages détectés. Veuillez utiliser une photo avec un seul visage.`;
				needsNewPhoto = true;
				if (shouldCleanup) await cleanupAsset(assetIdToDelete);
			}
		} catch (error: unknown) {
			uploadStatus = `Erreur: ${error instanceof Error ? error.message : 'Erreur inconnue'}`;
			if (shouldCleanup) await cleanupAsset(assetIdToDelete);
		}
	}

	async function cleanupAsset(id: string | null) {
		if (!id) return;
		try {
			await fetch(`/api/immich/assets`, {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ids: [id] })
			});
		} catch (e) {
			console.warn(e);
		}
	}

	async function importPhoto(file: File) {
		if (!file) return;
		const userId = (page.data.session?.user as User)?.id_user;
		if (!userId) {
			toast.error("Pas d'utilisateur connecté");
			return;
		}

		isProcessing = true;
		uploadStatus = 'Upload en cours...';
		assetId = null;
		personId = null;
		needsNewPhoto = false;
		abortController = new AbortController();
		const signal = abortController.signal;

		let isDuplicate = false;
		let uploadedAssetId: string | null = null;

		try {
			let uploadResponse: Response;
			uploadResponse = await uploadFileChunked(file, signal);

			if (!uploadResponse.ok) throw new Error(`Erreur upload: ${uploadResponse.statusText}`);
			const uploadData = (await uploadResponse.json()) as Record<string, unknown>;

			if (uploadData.status === 'duplicate' && uploadData.id) {
				isDuplicate = true;
				uploadedAssetId = String(uploadData.id);
				uploadStatus = 'Utilisation de la photo existante.';
			} else if (uploadData.duplicateId) {
				isDuplicate = true;
				uploadedAssetId = String(uploadData.duplicateId);
				uploadStatus = 'Utilisation de la photo existante.';
			} else if (uploadData.id) {
				uploadedAssetId = String(uploadData.id);
			} else {
				throw new Error("Pas d'ID retourné");
			}

			assetId = uploadedAssetId;

			const maxAttempts = 15;
			let attempt = 0;
			let faceDetected = false;
			while (attempt < maxAttempts && !faceDetected) {
				await new Promise((resolve) => setTimeout(resolve, 1000));
				attempt++;
				uploadStatus = `Analyse de l'image... (${attempt}s)`;
				try {
					const checkResponse = await fetch(`/api/immich/assets/${assetId}?nocache=${Date.now()}`, {
						signal
					});
					if (checkResponse.ok) {
						const checkData = await checkResponse.json();
						if (checkData.people && checkData.people.length > 0) {
							faceDetected = true;
							break;
						}
					}
				} catch (err: unknown) {
					if (err instanceof Error && err.name === 'AbortError') throw err;
				}
			}

			const shouldDeleteAfter = !isDuplicate && !!uploadedAssetId;
			await checkForPeople(shouldDeleteAfter, uploadedAssetId);
		} catch (error: unknown) {
			if (error instanceof Error && error.name === 'AbortError') return;
			if (!isDuplicate && uploadedAssetId) await cleanupAsset(uploadedAssetId);
			uploadStatus = `Erreur: ${error instanceof Error ? error.message : 'Erreur inconnue'}`;
		} finally {
			isProcessing = false;
			abortController = null;
		}
	}

	$effect(() => {
		const handleBeforeUnload = (e: BeforeUnloadEvent) => {
			if (isProcessing && abortController) {
				abortController.abort();
				e.preventDefault();
				e.returnValue = '';
			}
		};
		window.addEventListener('beforeunload', handleBeforeUnload);
		return () => {
			window.removeEventListener('beforeunload', handleBeforeUnload);
		};
	});

	async function deleteMyAccount() {
		if (deleteConfirmText !== 'CONFIRMATION') {
			toast.error('Veuillez taper "CONFIRMATION"');
			return;
		}
		isDeletingAccount = true;
		try {
			const response = await fetch('/api/users/me', { method: 'DELETE' });
			const data = (await response.json()) as { success?: boolean; error?: string };
			if (data.success) {
				toast.success('Compte supprimé.');
				showDeleteAccountModal = false;
				setTimeout(() => {
					goto('/api/auth/signout');
				}, 1000);
			} else {
				toast.error(data.error || 'Erreur inconnue');
			}
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Erreur inconnue');
		} finally {
			isDeletingAccount = false;
		}
	}

	function openDeleteAccountModal() {
		deleteConfirmText = '';
		showDeleteAccountModal = true;
	}
</script>

<svelte:head>
	<title>Paramètres - MiGallery</title>
</svelte:head>

<main class="settings-main">
	<BackgroundBlobs />

	<div class="settings-container">
		<header class="page-header settings-header centered">
			<div class="header-content">
				<h1>Paramètres</h1>
				<p class="subtitle">Gérez votre profil, vos préférences et votre confidentialité</p>
			</div>
		</header>

		<section class="settings-card glass-card">
			<div class="card-header">
				<div class="icon-wrapper blue">
					<UserIcon size={24} />
				</div>
				<div>
					<h2>Profil</h2>
					<p>Gérez vos informations personnelles</p>
				</div>
			</div>

			<div class="card-body">
				<div class="preference-row">
					<div class="pref-info">
						<span class="pref-title">Photo de profil</span>
						<span class="pref-desc">Modifier la photo affichée sur votre profil</span>
					</div>
					<button
						onclick={() => (showChangePhotoModal = true)}
						class="btn-secondary"
						disabled={!currentUserHasFace}
						title={!currentUserHasFace ? "Vous devez d'abord configurer la reconnaissance faciale" : ''}
					>
						<Camera size={18} />
						<span>Choisir sa photo</span>
					</button>
				</div>
			</div>
		</section>

		<section class="settings-card glass-card">
			<div class="card-header">
				<div class="icon-wrapper blue">
					<Palette size={24} />
				</div>
				<div>
					<h2>Apparence</h2>
					<p>Personnalisez votre expérience visuelle</p>
				</div>
			</div>

			<div class="card-body">
				<div class="preference-row">
					<div class="pref-info">
						<span class="pref-title">Thème de l'interface</span>
						<span class="pref-desc">Basculer entre le mode clair et sombre</span>
					</div>
					<button onclick={() => theme.toggle()} class="theme-toggle-btn" aria-label="Basculer le thème">
						{#if $theme === 'dark'}
							<Sun size={20} /> <span>Mode Clair</span>
						{:else}
							<Moon size={20} /> <span>Mode Sombre</span>
						{/if}
					</button>
				</div>
			</div>
		</section>

		<section class="settings-card glass-card">
			<div class="card-header">
				<div class="icon-wrapper purple">
					<ScanFace size={24} />
				</div>
				<div>
					<h2>Reconnaissance Faciale</h2>
					<p>Pour activer la fonctionnalité "Mes photos"</p>
				</div>
			</div>

			<div class="card-body">
				<div class="info-box">
					<p>
						<Info size={18} class="flex-shrink-0" />
						Cette photo sert uniquement à générer votre empreinte biométrique. Elle sera
						<strong>supprimée automatiquement sous 24h</strong> après traitement.
					</p>
				</div>

				<div class="camera-section">
					<div class="camera-wrapper">
						<CameraInput onPhoto={importPhoto} disabled={isProcessing} />
					</div>

					<div class="camera-status">
						{#if isProcessing}
							<div class="status-processing">
								<Spinner size={20} /> <span>{uploadStatus}</span>
							</div>
						{:else if assetId && !needsNewPhoto}
							<div class="status-success">
								<CheckCircle size={20} />
								<span>Visage configuré avec succès !</span>
							</div>
						{:else if needsNewPhoto}
							<div class="status-error">
								<AlertCircle size={20} />
								<span>Erreur : Plusieurs visages détectés.</span>
							</div>
						{:else}
							<p class="text-hint">Prenez un selfie ou importez une photo claire de votre visage.</p>
						{/if}
					</div>
				</div>
			</div>
		</section>

		{#if currentUserHasFace}
			<section class="settings-card glass-card">
				<div class="card-header">
					<div class="icon-wrapper green">
						<Share2 size={24} />
					</div>
					<div>
						<h2>Partage de mes photos</h2>
						<p>Contrôlez qui peut voir les photos où vous apparaissez</p>
					</div>
				</div>

				<div class="card-body">
					<div class="permission-add-row">
						<input
							type="text"
							bind:value={newAuthUserId}
							placeholder="Identifiant utilisateur (ex: prenom.nom)"
							class="settings-input"
							disabled={isAddingPermission}
							onkeydown={(e) => e.key === 'Enter' && addPhotoPermission()}
						/>
						<button
							onclick={addPhotoPermission}
							class="theme-toggle-btn"
							disabled={isAddingPermission || !newAuthUserId.trim()}
						>
							{#if isAddingPermission}<Spinner size={16} />{/if}
							<span>Autoriser</span>
						</button>
					</div>

					<div class="permissions-container">
						{#if isLoadingPermissions}
							<div class="loading-state"><Spinner size={20} /> Chargement...</div>
						{:else if photoPermissions.length > 0}
							<div class="permissions-grid">
								{#each photoPermissions as perm}
									<div class="permission-chip">
										<div class="chip-avatar">
											<UserIcon size={14} />
										</div>
										<div class="chip-info">
											<span class="chip-name">{perm.authorized_prenom} {perm.authorized_nom}</span>
											<span class="chip-id">{perm.authorized_id}</span>
										</div>
										<button
											class="chip-remove"
											onclick={() => revokePhotoPermission(perm.authorized_id)}
											title="Révoquer l'accès"
										>
											<X size={14} />
										</button>
									</div>
								{/each}
							</div>
						{:else}
							<div class="empty-state">
								<p>Aucune autorisation active. Vos photos sont privées.</p>
							</div>
						{/if}
					</div>
				</div>
			</section>
		{/if}

		<section class="settings-card glass-card">
			<div class="card-header">
				<div class="icon-wrapper indigo">
					<Users size={24} />
				</div>
				<div>
					<h2>Profils partagés avec moi</h2>
					<p>Accédez aux photos des amis qui vous ont autorisé</p>
				</div>
			</div>

			<div class="card-body">
				{#if isLoadingSharedWithMe}
					<div class="loading-state"><Spinner size={20} /> Chargement...</div>
				{:else if sharedWithMe.length > 0}
					<div class="shared-list">
						{#each sharedWithMe as shared}
							<a href="/mes-photos?userId={shared.owner_id}" class="shared-item">
								<div class="shared-avatar">
									{shared.owner_prenom[0]}{shared.owner_nom[0]}
								</div>
								<div class="shared-info">
									<span class="shared-name">{shared.owner_prenom} {shared.owner_nom}</span>
									<span class="shared-date"
										>Depuis le {new Date(shared.created_at).toLocaleDateString()}</span
									>
								</div>
								<ChevronRight size={16} class="text-gray-400" />
							</a>
						{/each}
					</div>
				{:else}
					<div class="empty-state">
						<p>Personne ne vous a encore partagé l'accès à ses photos.</p>
					</div>
				{/if}
			</div>
		</section>

		<section class="settings-card danger-zone">
			<div class="card-header">
				<div class="icon-wrapper red">
					<AlertTriangle size={24} />
				</div>
				<div>
					<h2>Zone de Danger</h2>
					<p>Actions irréversibles sur votre compte</p>
				</div>
			</div>

			<div class="card-body">
				{#if currentUserHasFace}
					<div class="danger-row">
						<div class="danger-info">
							<strong>Dissocier mon visage</strong>
							<p>Supprime votre empreinte biométrique. Vous perdrez l'accès à "Mes photos".</p>
						</div>
						<button
							onclick={() => {
								showUnlinkFaceModal = true;
							}}
							class="btn-outline-danger"
						>
							Dissocier
						</button>
					</div>
					<div class="separator"></div>
				{/if}

				<div class="danger-row">
					<div class="danger-info">
						<strong>Supprimer mon compte</strong>
						<p>Supprime définitivement vos données, préférences et accès.</p>
					</div>
					<button onclick={openDeleteAccountModal} class="btn-danger"> Supprimer </button>
				</div>
			</div>
		</section>

		<footer class="settings-footer">
			<div class="footer-links">
				<a href="https://mitv.fr" target="_blank">MiTV</a> •
				<a href="/cgu">CGU</a> •
				<a href="mailto:bureau@mitv.fr">Contact</a>
			</div>
			<p class="copyright">2025 MiTV - Développé par Jolan BOUDIN & Gabriel DUPONT</p>
		</footer>
	</div>
</main>

<Modal
	bind:show={showDeleteAccountModal}
	title="Supprimer votre compte"
	type="warning"
	icon="alert-triangle"
	confirmText={isDeletingAccount ? 'Suppression...' : 'Supprimer définitivement'}
	cancelText="Annuler"
	confirmDisabled={deleteConfirmText !== 'CONFIRMATION' || isDeletingAccount}
	onConfirm={deleteMyAccount}
	onCancel={() => {
		showDeleteAccountModal = false;
		deleteConfirmText = '';
	}}
>
	{#snippet children()}
		<div class="modal-content">
			<p class="text-danger font-bold mb-4">Cette action est irréversible !</p>
			<p class="mb-4">Tapez <strong>CONFIRMATION</strong> pour valider :</p>
			<input
				type="text"
				bind:value={deleteConfirmText}
				placeholder="Tapez CONFIRMATION"
				class="settings-input w-full"
				disabled={isDeletingAccount}
			/>
		</div>
	{/snippet}
</Modal>

<Modal
	bind:show={showUnlinkFaceModal}
	title="Dissocier mon visage"
	type="warning"
	icon="user-x"
	confirmText={isUnlinkingFace ? 'Dissociation...' : 'Dissocier'}
	cancelText="Annuler"
	confirmDisabled={isUnlinkingFace}
	onConfirm={unlinkMyFace}
	onCancel={() => {
		showUnlinkFaceModal = false;
	}}
>
	{#snippet children()}
		<p>Vous perdrez l'accès à la page "Mes photos". Votre compte restera actif.</p>
	{/snippet}
</Modal>

<Modal
	bind:show={showFaceAlreadyAssignedModal}
	title="Visage déjà associé"
	type="warning"
	icon="alert-circle"
	confirmText="J'ai compris"
	onConfirm={() => {
		showFaceAlreadyAssignedModal = false;
	}}
>
	{#snippet children()}
		<p>Ce visage est déjà assigné à un autre compte. Contactez le bureau MiTV si c'est une erreur.</p>
	{/snippet}
</Modal>

{#if showChangePhotoModal}
	<ChangePhotoModal
		peopleId={personId ?? undefined}
		onClose={() => (showChangePhotoModal = false)}
		onPhotoSelected={handlePhotoSelected}
	/>
{/if}

<style>
	.settings-main {
		--st-bg: var(--bg-primary, #ffffff);
		--st-card-bg: var(--bg-secondary, #ffffff);
		--st-text: var(--text-primary, #1f2937);
		--st-text-muted: var(--text-secondary, #6b7280);
		--st-border: var(--border, #e5e7eb);
		--st-accent: var(--accent, #3b82f6);
		--st-danger: #ef4444;
		--st-danger-bg: #fef2f2;
		--st-danger-border: #fecaca;

		position: relative;
		min-height: 100vh;
		padding: 4rem 0 6rem;
		color: var(--st-text);
		overflow-x: hidden;
	}

	:global([data-theme='dark']) .settings-main {
		--st-bg: var(--bg-primary, #0f172a);
		--st-card-bg: var(--bg-secondary, #1e293b);
		--st-text: var(--text-primary, #f3f4f6);
		--st-text-muted: var(--text-secondary, #9ca3af);
		--st-border: var(--border, #334155);
		--st-danger-bg: rgba(239, 68, 68, 0.1);
		--st-danger-border: rgba(239, 68, 68, 0.3);
	}

	.settings-container {
		position: relative;
		z-index: 1;
		max-width: 720px;
		margin: 0 auto;
		padding: 0 1.5rem;
	}

	.settings-header {
		margin-bottom: 3rem;
		text-align: center;
	}

	.subtitle {
		font-size: 1.1rem;
		color: var(--st-text-muted);
	}

	.settings-card {
		background: var(--st-card-bg);
		border: 1px solid var(--st-border);
		border-radius: 1rem;
		margin-bottom: 2rem;
		overflow: hidden;
		box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
		transition:
			transform 0.2s,
			box-shadow 0.2s;
	}

	.settings-card:hover {
		box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.05);
	}

	.card-header {
		padding: 1.5rem;
		border-bottom: 1px solid var(--st-border);
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.card-header h2 {
		font-size: 1.25rem;
		font-weight: 700;
		color: var(--st-text);
		margin: 0;
	}
	.card-header p {
		font-size: 0.9rem;
		color: var(--st-text-muted);
		margin: 0.25rem 0 0;
	}

	.icon-wrapper {
		width: 48px;
		height: 48px;
		border-radius: 12px;
		display: flex;
		align-items: center;
		justify-content: center;
		color: white;
		font-weight: bold;
	}
	.icon-wrapper.blue {
		background: linear-gradient(135deg, #3b82f6, #2563eb);
	}
	.icon-wrapper.purple {
		background: linear-gradient(135deg, #a855f7, #7c3aed);
	}
	.icon-wrapper.green {
		background: linear-gradient(135deg, #10b981, #059669);
	}
	.icon-wrapper.indigo {
		background: linear-gradient(135deg, #6366f1, #4f46e5);
	}
	.icon-wrapper.red {
		background: linear-gradient(135deg, #ef4444, #dc2626);
	}

	.card-body {
		padding: 1.5rem;
	}

	.preference-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.pref-title {
		display: block;
		font-weight: 600;
		color: var(--st-text);
	}
	.pref-desc {
		font-size: 0.9rem;
		color: var(--st-text-muted);
	}

	.theme-toggle-btn {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 1rem;
		background: var(--st-bg);
		border: 1px solid var(--st-border);
		border-radius: 99px;
		color: var(--st-text);
		cursor: pointer;
		font-weight: 500;
		transition: all 0.2s;
	}
	.theme-toggle-btn:hover {
		border-color: var(--st-accent);
		color: var(--st-accent);
	}

	.info-box {
		display: flex;
		gap: 0.75rem;
		background: rgba(59, 130, 246, 0.1);
		color: var(--st-text);
		padding: 1rem;
		border-radius: 0.75rem;
		font-size: 0.95rem;
		margin-bottom: 1.5rem;
	}

	.camera-section {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
	}
	.camera-status {
		text-align: center;
	}
	.status-processing {
		color: var(--st-accent);
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.status-success {
		color: #10b981;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-weight: 500;
	}
	.status-error {
		color: #ef4444;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-weight: 500;
	}
	.text-hint {
		color: var(--st-text-muted);
		font-size: 0.9rem;
	}

	/* --- FORMS & INPUTS --- */
	.settings-input {
		padding: 0.75rem 1rem;
		border: 1px solid var(--st-border);
		border-radius: 0.5rem;
		background: var(--st-bg);
		color: var(--st-text);
		outline: none;
		transition: border-color 0.2s;
	}
	.settings-input:focus {
		border-color: var(--st-accent);
	}
	.settings-input:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.permission-add-row {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 1.5rem;
	}
	.permission-add-row input {
		flex: 1;
	}

	/* --- PERMISSIONS LIST --- */
	.permission-chip {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.5rem 0.75rem;
		background: var(--st-bg);
		border: 1px solid var(--st-border);
		border-radius: 99px;
	}
	.chip-avatar {
		width: 28px;
		height: 28px;
		background: var(--st-border);
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--st-text-muted);
	}
	.chip-info {
		display: flex;
		flex-direction: column;
		line-height: 1.1;
	}
	.chip-name {
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--st-text);
	}
	.chip-id {
		font-size: 0.75rem;
		color: var(--st-text-muted);
	}
	.chip-remove {
		background: none;
		border: none;
		cursor: pointer;
		color: var(--st-text-muted);
		padding: 4px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.chip-remove:hover {
		background: #fee2e2;
		color: #ef4444;
	}

	/* --- SHARED LIST --- */
	.shared-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.shared-item {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.75rem;
		background: var(--st-bg);
		border-radius: 0.75rem;
		text-decoration: none;
		border: 1px solid transparent;
		transition: all 0.2s;
	}
	.shared-item:hover {
		border-color: var(--st-accent);
		transform: translateX(2px);
	}
	.shared-avatar {
		width: 40px;
		height: 40px;
		background: linear-gradient(135deg, #a855f7, #ec4899);
		border-radius: 50%;
		color: white;
		font-weight: bold;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.9rem;
	}
	.shared-info {
		flex: 1;
		display: flex;
		flex-direction: column;
	}
	.shared-name {
		font-weight: 600;
		color: var(--st-text);
	}
	.shared-date {
		font-size: 0.8rem;
		color: var(--st-text-muted);
	}

	.empty-state {
		text-align: center;
		color: var(--st-text-muted);
		font-style: italic;
		padding: 1rem;
	}

	/* --- DANGER ZONE --- */
	.danger-zone {
		border-color: var(--st-danger-border);
		background: var(--st-danger-bg);
	}
	.danger-info strong {
		color: var(--st-text);
		display: block;
		margin-bottom: 0.25rem;
	}
	.danger-info p {
		margin: 0;
		font-size: 0.9rem;
	}
	.separator {
		height: 1px;
		background: var(--st-danger-border);
		margin: 1rem 0;
	}

	.btn-danger {
		background: var(--st-danger);
		color: white;
		border: none;
		padding: 0.5rem 1rem;
		border-radius: 0.5rem;
		font-weight: 600;
		cursor: pointer;
		transition: background 0.2s;
	}
	.btn-danger:hover {
		background: #dc2626;
	}
	.btn-outline-danger {
		background: transparent;
		color: var(--st-danger);
		border: 1px solid var(--st-danger);
		padding: 0.5rem 1rem;
		border-radius: 0.5rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
	}
	.btn-outline-danger:hover {
		background: var(--st-danger);
		color: white;
	}

	/* --- FOOTER --- */
	.settings-footer {
		text-align: center;
		margin-top: 4rem;
		color: var(--st-text-muted);
	}
	.footer-links a:hover {
		color: var(--st-accent);
	}
	.copyright {
		font-size: 0.85rem;
		margin-top: 0.5rem;
		opacity: 0.7;
	}

	@media (max-width: 640px) {
		.settings-main {
			padding-top: 2rem;
		}
		.card-header {
			flex-direction: column;
			text-align: center;
		}
		.danger-row {
			flex-direction: column;
			text-align: center;
			gap: 1rem;
		}
		.preference-row {
			flex-direction: column;
			text-align: center;
			gap: 1rem;
		}
	}
</style>
