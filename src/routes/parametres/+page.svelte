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
	let detectionTimeout = $state<boolean>(false);
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
		authorized_name: string;
		authorized_first_name: string | null;
		authorized_last_name: string | null;
		created_at: string;
	}
	interface SharedWithMe {
		owner_id: string;
		owner_name: string;
		owner_first_name: string | null;
		owner_last_name: string | null;
		created_at: string;
	}
	let photoPermissions = $state<PhotoPermission[]>([]);
	let sharedWithMe = $state<SharedWithMe[]>([]);
	let newAuthUserId = $state<string>('');
	let isAddingPermission = $state<boolean>(false);
	let isLoadingPermissions = $state<boolean>(false);
	let isLoadingSharedWithMe = $state<boolean>(false);

	interface AvailableUser {
		id_user: string;
		name: string;
		first_name: string | null;
		last_name: string | null;
		formation: string | null;
		promo: number | null;
	}

	let availableUsers = $state<AvailableUser[]>([]);
	let isLoadingAvailableUsers = $state<boolean>(false);
	let searchQuery = $state<string>('');
	let showUserDropdown = $state<boolean>(false);

	$effect(() => {
		loadCurrentUserFaceStatus();
		loadPhotoPermissions();
		loadSharedWithMe();
		loadAvailableUsers();
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

	async function loadAvailableUsers() {
		isLoadingAvailableUsers = true;
		try {
			const response = await fetch('/api/users/me/photo-access/options');
			const data = (await response.json()) as { success?: boolean; users?: AvailableUser[] };
			if (data.success && data.users) {
				availableUsers = data.users;
			}
		} catch (e) {
			console.warn('Erreur chargement utilisateurs disponibles:', e);
		} finally {
			isLoadingAvailableUsers = false;
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
			toast.error('Veuillez sélectionner un utilisateur');
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
				searchQuery = '';
				showUserDropdown = false;
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
		assetIdToDelete: string | null = null,
		isTimeoutCheck: boolean = false
	) {
		const userId = (page.data.session?.user as User)?.id_user;
		if (!userId || !assetId) {
			console.warn('⚠️  [Face Pairing] checkForPeople: userId ou assetId manquant', { userId, assetId });
			return;
		}
		let shouldCleanup = shouldDeleteAfter && assetIdToDelete;
		console.log('🔍 [Face Pairing] checkForPeople début:', { userId, assetId, shouldCleanup, isTimeoutCheck });

		try {
			uploadStatus = 'Récupération des personnes détectées...';
			const assetInfoResponse = await fetch(`/api/immich/assets/${assetId}`);
			if (!assetInfoResponse.ok) {
				const errMsg = `Erreur récupération asset: ${assetInfoResponse.statusText}`;
				console.error('❌ [Face Pairing] Récupération asset échouée:', errMsg);
				throw new Error(errMsg);
			}
			const assetInfoData = await assetInfoResponse.json();
			const assetInfo = assetInfoData as { people?: Array<{ id: string }> };
			const people = assetInfo.people || [];
			console.log(`📊 [Face Pairing] Asset récupéré: ${people.length} personne(s) détectée(s)`);

			uploadStatus = `${people.length} personne(s) détectée(s)`;

			if (people.length === 1) {
				personId = people[0].id;
				uploadStatus = `Visage détecté, enregistrement...`;
				console.log('👤 [Face Pairing] Enregistrement du visage:', personId);

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
					console.warn('⚠️  [Face Pairing] Visage déjà assigné à un autre compte');
					uploadStatus = 'Ce visage est déjà associé à un autre compte.';
					showFaceAlreadyAssignedModal = true;
					if (shouldCleanup) {
						try {
							console.log('🗑️  [Face Pairing] Nettoyage de l\'asset (face already assigned):', assetIdToDelete);
							await cleanupAsset(assetIdToDelete);
						} catch (e) {
							console.error('❌ [Face Pairing] Cleanup échoué (mais face assigné):', e);
						}
					}
					return;
				}

				if (updateData.success) {
					console.log('🎉 [Face Pairing] Visage enregistré avec succès!');
					uploadStatus = `Visage reconnu avec succès !`;
					if (shouldCleanup) {
						try {
							console.log('🗑️  [Face Pairing] Nettoyage de l\'asset (succès):', assetIdToDelete);
							await cleanupAsset(assetIdToDelete);
						} catch (e) {
							console.error('❌ [Face Pairing] Cleanup échoué (mais face assigné):', e);
						}
					}
					isProcessing = false;
					// Augmenter le délai pour laisser le temps à la DB de se synchroniser
					await new Promise((resolve) => setTimeout(resolve, 1500));
					console.log('🔄 [Face Pairing] Rechargement de la page...');
					window.location.href = window.location.href;
				} else {
					console.error('❌ [Face Pairing] Erreur enregistrement:', updateData.error);
					uploadStatus = `Erreur mise à jour BDD: ${updateData.error || 'Erreur inconnue'}`;
					if (shouldCleanup) {
						try {
							console.log('🗑️  [Face Pairing] Nettoyage de l\'asset (erreur DB):', assetIdToDelete);
							await cleanupAsset(assetIdToDelete);
						} catch (e) {
							console.error('❌ [Face Pairing] Cleanup échoué après erreur:', e);
						}
					}
				}
			} else if (people.length === 0) {
				// Différencier vrai "aucun visage" vs "timeout"
				if (isTimeoutCheck) {
					uploadStatus =
						'Délai de détection dépassé. Immich peut être occupé. Veuillez réessayer.';
					detectionTimeout = true;
				} else {
					uploadStatus = 'Aucun visage détecté. Veuillez utiliser une photo claire.';
				}
				if (shouldCleanup) {
					try {
						await cleanupAsset(assetIdToDelete);
					} catch (e) {
						console.warn('Cleanup failed:', e);
					}
				}
			} else {
				uploadStatus = `${people.length} visages détectés. Veuillez utiliser une photo avec un seul visage.`;
				needsNewPhoto = true;
				if (shouldCleanup) {
					try {
						await cleanupAsset(assetIdToDelete);
					} catch (e) {
						console.warn('Cleanup failed:', e);
					}
				}
			}
		} catch (error: unknown) {
			console.error('❌ [Face Pairing] Erreur checkForPeople:', error);
			uploadStatus = `Erreur: ${error instanceof Error ? error.message : 'Erreur inconnue'}`;
			if (shouldCleanup) {
				try {
					console.log('🗑️  [Face Pairing] Nettoyage de l\'asset (après erreur):', assetIdToDelete);
					await cleanupAsset(assetIdToDelete);
				} catch (e) {
					console.error('❌ [Face Pairing] Cleanup after error échoué:', e);
				}
			}
		}
	}

	async function cleanupAsset(id: string | null) {
		if (!id) {
			console.warn('⚠️  [Face Pairing] cleanupAsset appelé sans ID');
			return;
		}
		console.log('🗑️  [Face Pairing] Suppression de l\'asset Immich:', id);
		try {
			const response = await fetch(`/api/immich/assets`, {
				method: 'DELETE',
				headers: {
					'Content-Type': 'application/json',
					'X-Face-Pairing-Cleanup': 'true'
				},
				body: JSON.stringify({ ids: [id] })
			});
			if (!response.ok) {
				const errMsg = `Cleanup failed: ${response.status} ${response.statusText}. Photo may not be deleted from Immich.`;
				console.error('❌ [Face Pairing]', errMsg);
				throw new Error(errMsg);
			}
			console.log('✅ [Face Pairing] Asset supprimé avec succès:', id);
		} catch (e) {
			// Relancer l'erreur pour que le caller puisse la gérer
			console.error('❌ [Face Pairing] cleanupAsset erreur:', e);
			throw e;
		}
	}

	async function importPhoto(file: File) {
		if (!file) return;
		const userId = (page.data.session?.user as User)?.id_user;
		if (!userId) {
			toast.error("Pas d'utilisateur connecté");
			return;
		}

		console.log('🔍 [Face Pairing] Début import photo:', { fileName: file.name, fileSize: file.size, userId });

		isProcessing = true;
		detectionTimeout = false;
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

			if (!uploadResponse.ok) {
				const errMsg = `Erreur upload: ${uploadResponse.statusText}`;
				console.error('❌ [Face Pairing] Upload échoué:', errMsg);
				throw new Error(errMsg);
			}
			console.log('✅ [Face Pairing] Upload réussi');
			const uploadData = (await uploadResponse.json()) as Record<string, unknown>;

			if (uploadData.status === 'duplicate' && uploadData.id) {
				isDuplicate = true;
				uploadedAssetId = String(uploadData.id);
				uploadStatus = 'Utilisation de la photo existante.';
				console.log('ℹ️  [Face Pairing] Duplicate détecté, réutilisation asset:', uploadedAssetId);
			} else if (uploadData.duplicateId) {
				isDuplicate = true;
				uploadedAssetId = String(uploadData.duplicateId);
				uploadStatus = 'Utilisation de la photo existante.';
				console.log('ℹ️  [Face Pairing] Duplicate détecté, réutilisation asset:', uploadedAssetId);
			} else if (uploadData.id) {
				uploadedAssetId = String(uploadData.id);
				console.log('✅ [Face Pairing] Asset créé:', uploadedAssetId);
			} else {
				console.error('❌ [Face Pairing] Pas d\'ID retourné:', uploadData);
				throw new Error("Pas d'ID retourné");
			}

			assetId = uploadedAssetId;

			// Augmenter à 60 secondes pour donner à Immich le temps de traiter
			console.log('⏳ [Face Pairing] Attente de la détection de visage (max 60s)...');
			const maxAttempts = 60;
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
							console.log(`✅ [Face Pairing] Visage détecté à ${attempt}s! People count:`, checkData.people.length);
							faceDetected = true;
							break;
						}
					}
				} catch (err: unknown) {
					if (err instanceof Error && err.name === 'AbortError') throw err;
				}
			}
			if (!faceDetected) {
				console.warn('⏱️  [Face Pairing] Timeout atteint (60s), aucun visage détecté');
			}

			const shouldDeleteAfter = !isDuplicate && !!uploadedAssetId;
			// Passer le flag isTimeoutCheck=true si on a atteint le max d'attempts
			const isTimeout = attempt >= maxAttempts && !faceDetected;
			console.log('🔄 [Face Pairing] Appel checkForPeople:', { shouldDeleteAfter, uploadedAssetId, isTimeout, isDuplicate });
			await checkForPeople(shouldDeleteAfter, uploadedAssetId, isTimeout);
		} catch (error: unknown) {
			if (error instanceof Error && error.name === 'AbortError') {
				console.log('⚠️  [Face Pairing] Import annulé par l\'utilisateur');
				return;
			}
			console.error('❌ [Face Pairing] Erreur import:', error);
			if (!isDuplicate && uploadedAssetId) {
				try {
					console.log('🗑️  [Face Pairing] Cleanup de l\'asset après erreur:', uploadedAssetId);
					await cleanupAsset(uploadedAssetId);
				} catch (e) {
					console.error('❌ [Face Pairing] Cleanup after error échoué:', e);
				}
			}
			uploadStatus = `Erreur: ${error instanceof Error ? error.message : 'Erreur inconnue'}`;
		} finally {
			isProcessing = false;
			abortController = null;
			console.log('✔️  [Face Pairing] Import terminé');
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
						{:else if assetId && !needsNewPhoto && !detectionTimeout}
							<div class="status-success">
								<CheckCircle size={20} />
								<span>Visage configuré avec succès !</span>
							</div>
						{:else if needsNewPhoto}
							<div class="status-error">
								<AlertCircle size={20} />
								<div class="error-message">
									<span>Erreur : Plusieurs visages détectés.</span>
									<p class="text-sm">{uploadStatus}</p>
									<button
										onclick={() => {
											assetId = null;
											needsNewPhoto = false;
											detectionTimeout = false;
											uploadStatus = '';
										}}
										class="text-xs text-blue-500 hover:text-blue-600 mt-2"
									>
										Réessayer
									</button>
								</div>
							</div>
						{:else if detectionTimeout}
							<div class="status-warning">
								<AlertTriangle size={20} />
								<div class="error-message">
									<span>{uploadStatus}</span>
									<button
										onclick={() => {
											assetId = null;
											detectionTimeout = false;
											uploadStatus = '';
										}}
										class="text-xs text-blue-500 hover:text-blue-600 mt-2"
									>
										Réessayer
									</button>
								</div>
							</div>
						{:else if uploadStatus && !isProcessing}
							<div class="status-error">
								<AlertCircle size={20} />
								<div class="error-message">
									<span>{uploadStatus}</span>
									<button
										onclick={() => {
											assetId = null;
											needsNewPhoto = false;
											detectionTimeout = false;
											uploadStatus = '';
										}}
										class="text-xs text-blue-500 hover:text-blue-600 mt-2"
									>
										Réessayer
									</button>
								</div>
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
						<div class="user-selector">
							<input
								type="text"
								bind:value={searchQuery}
								placeholder="Rechercher un profil à autoriser..."
								class="settings-input selector-input"
								disabled={isAddingPermission || isLoadingAvailableUsers}
								onfocus={() => {
									showUserDropdown = true;
									if (availableUsers.length === 0) loadAvailableUsers();
								}}
								onblur={() => {
									setTimeout(() => {
										showUserDropdown = false;
									}, 200);
								}}
							/>
							{#if showUserDropdown && availableUsers.length > 0}
								<div class="user-dropdown">
									{#if isLoadingAvailableUsers}
										<div class="dropdown-loading"><Spinner size={16} /> Chargement...</div>
									{:else}
										{#each availableUsers.filter((u) => {
											const query = searchQuery.toLowerCase();
											return (
												u.name.toLowerCase().includes(query) ||
												(u.first_name?.toLowerCase() ?? '').includes(query) ||
												(u.last_name?.toLowerCase() ?? '').includes(query) ||
												(u.formation?.toLowerCase() ?? '').includes(query) ||
												u.id_user.toLowerCase().includes(query)
											);
										}) as user (user.id_user)}
											<button
												type="button"
												class="dropdown-item"
												onclick={() => {
													newAuthUserId = user.id_user;
													searchQuery = user.name;
													showUserDropdown = false;
												}}
												disabled={isAddingPermission}
											>
												<div class="user-item-content">
													<div class="user-item-name">{user.name}</div>
													{#if user.formation || user.promo}
														<div class="user-item-meta">
															{#if user.promo}{user.promo}{/if}
															{#if user.formation}
																{#if user.promo}•{/if}
																{user.formation}
															{/if}
														</div>
													{/if}
												</div>
											</button>
										{/each}
									{/if}
								</div>
							{/if}
						</div>
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
											<span class="chip-name">{perm.authorized_name}</span>
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
									{(shared.owner_first_name || 'U')[0]}{(shared.owner_last_name || '')[0] || 'U'}
								</div>
								<div class="shared-info">
									<span class="shared-name">{shared.owner_name}</span>
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
	.status-warning {
		color: #f59e0b;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-weight: 500;
	}
	.error-message {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
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
		align-items: flex-start;
	}

	.user-selector {
		flex: 1;
		position: relative;
	}

	.selector-input {
		width: 100%;
	}

	.user-dropdown {
		position: absolute;
		top: 100%;
		left: 0;
		right: 0;
		background: var(--st-card-bg);
		border: 1px solid var(--st-border);
		border-top: none;
		border-radius: 0 0 0.5rem 0.5rem;
		max-height: 300px;
		overflow-y: auto;
		z-index: 10;
		box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
	}

	.dropdown-loading {
		padding: 1rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--st-text-muted);
		justify-content: center;
	}

	.dropdown-item {
		width: 100%;
		padding: 0.75rem 1rem;
		border: none;
		background: none;
		text-align: left;
		cursor: pointer;
		color: var(--st-text);
		font-size: 0.95rem;
		transition: background-color 0.2s;
	}

	.dropdown-item:hover:not(:disabled) {
		background: var(--st-bg);
	}

	.dropdown-item:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.user-item-content {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.user-item-name {
		font-weight: 500;
		color: var(--st-text);
	}

	.user-item-meta {
		font-size: 0.85rem;
		color: var(--st-text-muted);
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
