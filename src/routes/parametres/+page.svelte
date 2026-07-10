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
		ScanEye,
		Info,
		CheckCircle,
		AlertCircle,
		Share2,
		X,
		Users,
		ChevronRight,
		AlertTriangle,
		Languages,
		Shield
	} from 'lucide-svelte';
	import Modal from '$lib/components/Modal.svelte';
	import Spinner from '$lib/components/Spinner.svelte';
	import CameraInput from '$lib/components/CameraInput.svelte';
	import BackgroundBlobs from '$lib/components/BackgroundBlobs.svelte';
	import ChangePhotoModal from '$lib/components/ChangePhotoModal.svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import { fuzzyMatch } from '$lib/fuzzy';
	import { PhotosState } from '$lib/photos.svelte';
	import { theme } from '$lib/theme';
	import { asApiResponse } from '$lib/ts-utils';
	import type { UserRow, Album, User } from '$lib/types/api';
	import { showConfirm } from '$lib/confirm';
	import { toast } from '$lib/toast';
	import { uploadFileChunked } from '$lib/album-operations';
	import { m } from '$lib/paraglide/messages';
	import { getLocale, setLocale, type Locale } from '$lib/paraglide/runtime';

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
		authorized_promo: number | null;
		authorized_formation: string | null;
		created_at: string;
	}
	interface SharedWithMe {
		owner_id: string;
		owner_name: string;
		owner_first_name: string | null;
		owner_last_name: string | null;
		owner_promo: number | null;
		owner_formation: string | null;
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
		if (!u?.photos_id) {
			toast.error(m.param_no_immich_link());
			return;
		}

		const updateRes = await fetch(`/api/immich/people/${u.photos_id}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ featureFaceAssetId: assetId })
		});

		if (!updateRes.ok) {
			const txt = await updateRes.text().catch(() => updateRes.statusText);
			throw new Error(txt || m.param_photo_update_error());
		}

		toast.success(m.param_photo_updated());
		window.location.reload();
	}

	async function loadCurrentUserFaceStatus() {
		try {
			const response = await fetch('/api/users/me');
			const data = (await response.json()) as {
				success?: boolean;
				user?: { photos_id?: string | null };
			};
			if (data.success && data.user) {
				currentUserHasFace = !!data.user.photos_id;
				personId = data.user.photos_id ?? null;
			}
		} catch {
			/* Ignore */
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
			/* Ignore */
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
			/* Ignore load error */
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
			/* Ignore */
		} finally {
			isLoadingSharedWithMe = false;
		}
	}

	async function addPhotoPermission() {
		if (!newAuthUserId.trim()) {
			toast.error(m.param_select_user());
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
				toast.success(data.message || m.param_auth_added());
				newAuthUserId = '';
				searchQuery = '';
				showUserDropdown = false;
				await loadPhotoPermissions();
			} else {
				toast.error(data.error || m.param_add_error());
			}
		} catch (e) {
			toast.error(m.common_error_detail({ error: e instanceof Error ? e.message : m.common_unknown_error() }));
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
				toast.success(m.param_auth_revoked());
				await loadPhotoPermissions();
			} else {
				toast.error(data.error || m.param_revoke_error());
			}
		} catch (e) {
			toast.error(m.common_error_detail({ error: e instanceof Error ? e.message : m.common_unknown_error() }));
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
				toast.success(m.param_face_unlinked());
				showUnlinkFaceModal = false;
				currentUserHasFace = false;
				personId = null;
			} else {
				toast.error(m.common_error_detail({ error: data.error || m.common_unknown_error() }));
			}
		} catch (e) {
			toast.error(m.common_error_detail({ error: e instanceof Error ? e.message : m.common_unknown_error() }));
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
			return;
		}
		let shouldCleanup = shouldDeleteAfter && assetIdToDelete;

		try {
			uploadStatus = m.param_status_fetching();
			const assetInfoResponse = await fetch(`/api/immich/assets/${assetId}`);
			if (!assetInfoResponse.ok) {
				const errMsg = `Asset fetch error: ${assetInfoResponse.statusText}`;
				throw new Error(errMsg);
			}
			const assetInfoData = await assetInfoResponse.json();
			const assetInfo = assetInfoData as { people?: Array<{ id: string }> };
			const people = assetInfo.people || [];

			uploadStatus = m.param_status_detected_count({ count: people.length });

			if (people.length === 1) {
				personId = people[0].id;
				uploadStatus = m.param_status_saving();

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
					uploadStatus = m.param_status_face_taken();
					showFaceAlreadyAssignedModal = true;
					if (shouldCleanup) {
						try {
							await cleanupAsset(assetIdToDelete);
						} catch (e) {
							/* Ignore cleanup error */
						}
					}
					return;
				}

				if (updateData.success) {
					uploadStatus = m.param_face_ok();
					if (shouldCleanup) {
						try {
							await cleanupAsset(assetIdToDelete);
						} catch (e) {
							/* Ignore cleanup error */
						}
					}
					isProcessing = false;
					// Increase delay to give DB time to sync
					await new Promise((resolve) => setTimeout(resolve, 1500));
					window.location.href = window.location.href;
				} else {
					uploadStatus = m.param_db_update_error({
						error: updateData.error || m.common_unknown_error()
					});
					if (shouldCleanup) {
						try {
							await cleanupAsset(assetIdToDelete);
						} catch (e) {
							/* Ignore cleanup error */
						}
					}
				}
			} else if (people.length === 0) {
				// Distinguish actual "no face" vs "timeout"
				if (isTimeoutCheck) {
					uploadStatus =
						m.param_status_timeout();
					detectionTimeout = true;
				} else {
					uploadStatus = m.param_status_no_face();
				}
				if (shouldCleanup) {
					try {
						await cleanupAsset(assetIdToDelete);
					} catch (e) {
						console.warn('Cleanup failed:', e);
					}
				}
			} else {
				uploadStatus = m.param_status_multi_count({ count: people.length });
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
			uploadStatus = m.common_error_detail({
				error: error instanceof Error ? error.message : m.common_unknown_error()
			});
			if (shouldCleanup) {
				try {
					await cleanupAsset(assetIdToDelete);
				} catch (e) {
					/* Ignore cleanup error */
				}
			}
		}
	}

	async function cleanupAsset(id: string | null) {
		if (!id) {
			return;
		}
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
				throw new Error(errMsg);
			}
		} catch (e) {
			// Rethrow error so the caller can handle it
			throw e;
		}
	}

	async function importPhoto(file: File) {
		if (!file) return;
		const userId = (page.data.session?.user as User)?.id_user;
		if (!userId) {
			toast.error(m.param_no_user());
			return;
		}

		isProcessing = true;
		detectionTimeout = false;
		uploadStatus = m.param_status_uploading();
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
				const errMsg = `Upload error: ${uploadResponse.statusText}`;
				throw new Error(errMsg);
			}
			const uploadData = (await uploadResponse.json()) as Record<string, unknown>;

			if (uploadData.status === 'duplicate' && uploadData.id) {
				isDuplicate = true;
				uploadedAssetId = String(uploadData.id);
				uploadStatus = m.param_status_existing();
			} else if (uploadData.duplicateId) {
				isDuplicate = true;
				uploadedAssetId = String(uploadData.duplicateId);
				uploadStatus = m.param_status_existing();
			} else if (uploadData.id) {
				uploadedAssetId = String(uploadData.id);
			} else {
				throw new Error(m.param_no_id_returned());
			}

			assetId = uploadedAssetId;

			// Increase to 60 seconds to give Immich time to process
			const maxAttempts = 60;
			let attempt = 0;
			let faceDetected = false;
			while (attempt < maxAttempts && !faceDetected) {
				await new Promise((resolve) => setTimeout(resolve, 1000));
				attempt++;
				uploadStatus = m.param_status_analyzing({ seconds: attempt });
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
			// Pass the isTimeoutCheck=true flag if we reached max attempts
			const isTimeout = attempt >= maxAttempts && !faceDetected;
			await checkForPeople(shouldDeleteAfter, uploadedAssetId, isTimeout);
		} catch (error: unknown) {
			if (error instanceof Error && error.name === 'AbortError') {
				return;
			}
			if (!isDuplicate && uploadedAssetId) {
				try {
					await cleanupAsset(uploadedAssetId);
				} catch (e) {
					/* Ignore cleanup error */
				}
			}
			uploadStatus = m.common_error_detail({
				error: error instanceof Error ? error.message : m.common_unknown_error()
			});
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
			toast.error(m.param_type_confirmation());
			return;
		}
		isDeletingAccount = true;
		try {
			const response = await fetch('/api/users/me', { method: 'DELETE' });
			const data = (await response.json()) as { success?: boolean; error?: string };
			if (data.success) {
				toast.success(m.param_account_deleted());
				showDeleteAccountModal = false;
				setTimeout(() => {
					goto('/api/auth/signout');
				}, 1000);
			} else {
				toast.error(data.error || m.common_unknown_error());
			}
		} catch (e) {
			toast.error(e instanceof Error ? e.message : m.common_unknown_error());
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
	<title>{m.param_page_title()}</title>
</svelte:head>

<main class="settings-main">
	<BackgroundBlobs />

	<div class="settings-container">
		<header class="page-header settings-header centered">
			<div class="header-content">
				<h1>{m.nav_settings()}</h1>
				<p class="subtitle">{m.param_subtitle()}</p>
			</div>
		</header>

		<section class="settings-card glass-card">
			<div class="card-header">
				<div class="icon-wrapper blue">
					<UserIcon size={24} />
				</div>
				<div>
					<h2>{m.param_profile()}</h2>
					<p>{m.param_profile_sub()}</p>
				</div>
			</div>

			<div class="card-body">
				<div class="preference-row">
					<div class="pref-info">
						<span class="pref-title">{m.param_profile_photo()}</span>
						<span class="pref-desc">{m.param_profile_photo_desc()}</span>
					</div>
					<button
						type="button"
						onclick={() => (showChangePhotoModal = true)}
						class="btn-secondary"
						disabled={!currentUserHasFace}
						title={!currentUserHasFace ? m.param_need_face_first() : ''}
					>
						<Camera size={18} />
						<span>{m.param_choose_photo()}</span>
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
					<h2>{m.param_appearance()}</h2>
					<p>{m.param_appearance_sub()}</p>
				</div>
			</div>

			<div class="card-body">
				<div class="preference-row">
					<div class="pref-info">
						<span class="pref-title">{m.param_theme_label()}</span>
						<span class="pref-desc">{m.param_theme_desc()}</span>
					</div>
					<button type="button" onclick={() => theme.toggle()} class="theme-toggle-btn" aria-label={m.param_theme_toggle_aria()}>
						{#if $theme === 'dark'}
							<Sun size={20} /> <span>{m.param_theme_light()}</span>
						{:else}
							<Moon size={20} /> <span>{m.param_theme_dark()}</span>
						{/if}
					</button>
				</div>

				<div class="preference-row">
					<div class="pref-info">
						<span class="pref-title">{m.param_language()}</span>
						<span class="pref-desc">{m.param_language_desc()}</span>
					</div>
					<label class="lang-select">
						<Languages size={18} />
						<select
							value={getLocale()}
							onchange={(e) => setLocale((e.currentTarget as HTMLSelectElement).value as Locale)}
							aria-label={m.param_language()}
						>
							<option value="fr">{m.lang_french()}</option>
							<option value="en">{m.lang_english()}</option>
						</select>
					</label>
				</div>
			</div>
		</section>

		<section class="settings-card glass-card">
			<div class="card-header">
				<div class="icon-wrapper purple">
					<ScanEye size={24} />
				</div>
				<div>
					<h2>{m.param_face_title()}</h2>
					<p>{m.param_face_sub()}</p>
				</div>
			</div>

				<div class="card-body">
				<div class="info-box">
					<p>
						<Info size={18} class="flex-shrink-0" />
						{m.param_face_note_before()}
						<strong>{m.param_face_note_strong()}</strong> {m.param_face_note_after()}
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
								<span>{m.param_face_ok()}</span>
							</div>
						{:else if needsNewPhoto}
							<div class="status-error">
								<AlertCircle size={20} />
								<div class="error-message">
									<span>{m.param_face_multi()}</span>
									<p class="text-sm">{uploadStatus}</p>
									<button
										type="button"
										onclick={() => {
											assetId = null;
											needsNewPhoto = false;
											detectionTimeout = false;
											uploadStatus = '';
										}}
										class="retry-link"
									>
										{m.common_retry()}
									</button>
								</div>
							</div>
						{:else if detectionTimeout}
							<div class="status-warning">
								<AlertTriangle size={20} />
								<div class="error-message">
									<span>{uploadStatus}</span>
									<button
										type="button"
										onclick={() => {
											assetId = null;
											detectionTimeout = false;
											uploadStatus = '';
										}}
										class="retry-link"
									>
										{m.common_retry()}
									</button>
								</div>
							</div>
						{:else if uploadStatus && !isProcessing}
							<div class="status-error">
								<AlertCircle size={20} />
								<div class="error-message">
									<span>{uploadStatus}</span>
									<button
										type="button"
										onclick={() => {
											assetId = null;
											needsNewPhoto = false;
											detectionTimeout = false;
											uploadStatus = '';
										}}
										class="retry-link"
									>
										{m.common_retry()}
									</button>
								</div>
							</div>
						{:else}
							<p class="text-hint">{m.param_face_hint()}</p>
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
						<h2>{m.param_share_title()}</h2>
						<p>{m.param_share_sub()}</p>
					</div>
				</div>

				<div class="card-body">
					<div class="permission-add-row">
						<div class="user-selector">
							<input
								type="text"
								bind:value={searchQuery}
								placeholder={m.param_search_profile()}
								class="settings-input selector-input"
								disabled={isAddingPermission || isLoadingAvailableUsers}
								oninput={() => {
									// Typing invalidates any previously picked user so we never
									// authorize a stale selection that no longer matches the text.
									newAuthUserId = '';
									showUserDropdown = true;
								}}
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
										<div class="dropdown-loading"><Spinner size={16} /> {m.common_loading()}</div>
									{:else}
										{#each availableUsers.filter((u) => {
											const haystack = [
												u.name,
												u.first_name,
												u.last_name,
												u.formation,
												u.promo != null ? String(u.promo) : ''
											]
												.filter(Boolean)
												.join(' ');
											return fuzzyMatch(searchQuery, haystack);
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
							type="button"
							onclick={addPhotoPermission}
							class="theme-toggle-btn"
							disabled={isAddingPermission || !newAuthUserId.trim()}
						>
							{#if isAddingPermission}<Spinner size={16} />{/if}
							<span>{m.param_authorize()}</span>
						</button>
					</div>

					<div class="permissions-container">
						{#if isLoadingPermissions}
							<div class="loading-state"><Spinner size={20} /> {m.common_loading()}</div>
						{:else if photoPermissions.length > 0}
							<div class="person-list">
								{#each photoPermissions as perm}
									<div class="person-row">
										<Avatar
											userId={perm.authorized_id}
											firstName={perm.authorized_first_name}
											lastName={perm.authorized_last_name}
											name={perm.authorized_name}
										/>
										<div class="person-info">
											<span class="person-name">{perm.authorized_name}</span>
											<span class="person-meta">
												{#if perm.authorized_promo}<span class="person-promo"
														>{perm.authorized_promo}</span
													>{/if}
												{m.param_since_date({
													date: new Date(perm.created_at).toLocaleDateString(getLocale())
												})}
											</span>
										</div>
										<button
											type="button"
											class="person-action-btn"
											onclick={() => revokePhotoPermission(perm.authorized_id)}
											title={m.param_revoke_access()}
											aria-label={m.param_revoke_access()}
										>
											<X size={16} />
										</button>
									</div>
								{/each}
							</div>
						{:else}
							<EmptyState title={m.param_no_auth()} size="sm" />
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
					<h2>{m.param_shared_title()}</h2>
					<p>{m.param_shared_sub()}</p>
				</div>
			</div>

			<div class="card-body">
				{#if isLoadingSharedWithMe}
					<div class="loading-state"><Spinner size={20} /> {m.common_loading()}</div>
				{:else if sharedWithMe.length > 0}
					<div class="person-list">
						{#each sharedWithMe as shared}
							<a href="/mes-photos?userId={shared.owner_id}" class="person-row person-row-link">
								<Avatar
									userId={shared.owner_id}
									firstName={shared.owner_first_name}
									lastName={shared.owner_last_name}
									name={shared.owner_name}
								/>
								<div class="person-info">
									<span class="person-name">{shared.owner_name}</span>
									<span class="person-meta">
										{#if shared.owner_promo}<span class="person-promo">{shared.owner_promo}</span
											>{/if}
										{m.param_since_date({
											date: new Date(shared.created_at).toLocaleDateString(getLocale())
										})}
									</span>
								</div>
								<span class="person-chevron"><ChevronRight size={18} /></span>
							</a>
						{/each}
					</div>
				{:else}
					<EmptyState title={m.param_no_shared()} size="sm" />
				{/if}
			</div>
		</section>

		{#if isAdmin}
			<section class="settings-card glass-card">
				<div class="card-header">
					<div class="icon-wrapper indigo">
						<Shield size={24} />
					</div>
					<div>
						<h2>{m.param_admin_title()}</h2>
						<p>{m.param_admin_sub()}</p>
					</div>
				</div>

				<div class="card-body">
					<a href="/admin" class="admin-link-row">
						<div class="pref-info">
							<span class="pref-title">{m.param_admin_open()}</span>
							<span class="pref-desc">{m.param_admin_open_desc()}</span>
						</div>
						<ChevronRight size={20} />
					</a>
				</div>
			</section>
		{/if}

		<section class="settings-card danger-zone">
			<div class="card-header">
				<div class="icon-wrapper red">
					<AlertTriangle size={24} />
				</div>
				<div>
					<h2>{m.param_danger_title()}</h2>
					<p>{m.param_danger_sub()}</p>
				</div>
			</div>

			<div class="card-body">
				{#if currentUserHasFace}
					<div class="danger-row">
						<div class="danger-info">
							<strong>{m.param_unlink_face()}</strong>
							<p>{m.param_unlink_face_desc()}</p>
						</div>
						<button
							type="button"
							onclick={() => {
								showUnlinkFaceModal = true;
							}}
							class="btn-glass danger"
						>
							{m.param_unlink()}
						</button>
					</div>
					<div class="separator"></div>
				{/if}

				<div class="danger-row">
					<div class="danger-info">
						<strong>{m.param_delete_account()}</strong>
						<p>{m.param_delete_account_desc()}</p>
					</div>
					<button type="button" onclick={openDeleteAccountModal} class="btn-glass danger"> {m.common_delete()} </button>
				</div>
			</div>
		</section>

		<footer class="settings-footer">
			<div class="footer-links">
				<a href="https://mitv.fr" target="_blank">MiTV</a> •
				<a href="/cgu">{m.param_terms()}</a> •
				<a href="mailto:bureau@mitv.fr">Contact</a>
			</div>
			<p class="copyright">{m.param_copyright()}</p>
		</footer>
	</div>
</main>

<Modal
	bind:show={showDeleteAccountModal}
	title={m.param_delete_account_title()}
	type="warning"
	icon="alert-triangle"
	confirmText={isDeletingAccount ? m.param_deleting() : m.param_delete_permanent()}
	cancelText={m.common_cancel()}
	confirmDisabled={deleteConfirmText !== 'CONFIRMATION' || isDeletingAccount}
	onConfirm={deleteMyAccount}
	onCancel={() => {
		showDeleteAccountModal = false;
		deleteConfirmText = '';
	}}
>
	{#snippet children()}
		<div class="modal-content">
			<p class="text-danger font-bold mb-4">{m.param_delete_irreversible()}</p>
			<p class="mb-4">
				{m.param_type_confirm_prefix()} <strong>CONFIRMATION</strong> {m.param_type_confirm_suffix()}
			</p>
			<input
				type="text"
				bind:value={deleteConfirmText}
				placeholder={m.param_type_confirm_placeholder()}
				class="settings-input w-full"
				disabled={isDeletingAccount}
			/>
		</div>
	{/snippet}
</Modal>

<Modal
	bind:show={showUnlinkFaceModal}
	title={m.param_unlink_face()}
	type="warning"
	icon="user-x"
	confirmText={isUnlinkingFace ? m.param_unlinking() : m.param_unlink()}
	cancelText={m.common_cancel()}
	confirmDisabled={isUnlinkingFace}
	onConfirm={unlinkMyFace}
	onCancel={() => {
		showUnlinkFaceModal = false;
	}}
>
	{#snippet children()}
		<p>{m.param_unlink_confirm()}</p>
	{/snippet}
</Modal>

<Modal
	bind:show={showFaceAlreadyAssignedModal}
	title={m.param_face_taken_title()}
	type="warning"
	icon="alert-circle"
	confirmText={m.param_confirm_understood()}
	onConfirm={() => {
		showFaceAlreadyAssignedModal = false;
	}}
>
	{#snippet children()}
		<p>{m.param_face_taken_body()}</p>
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
		/* Danger-zone tint pair (theme-independent, derived from --error). */
		--st-danger-bg: color-mix(in srgb, var(--error) 7%, transparent);
		--st-danger-border: color-mix(in srgb, var(--error) 28%, transparent);

		position: relative;
		min-height: 100vh;
		padding: 4rem 0 6rem;
		color: var(--text-primary);
		overflow-x: hidden;
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
		color: var(--text-secondary);
	}

	.settings-card {
		background: var(--bg-secondary);
		border: 1px solid var(--border);
		border-radius: var(--radius);
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
		border-bottom: 1px solid var(--border);
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.card-header h2 {
		font-size: 1.25rem;
		font-weight: 700;
		color: var(--text-primary);
		margin: 0;
	}
	.card-header p {
		font-size: 0.9rem;
		color: var(--text-secondary);
		margin: 0.25rem 0 0;
	}

	.icon-wrapper {
		width: 48px;
		height: 48px;
		border-radius: var(--radius-md);
		display: flex;
		align-items: center;
		justify-content: center;
		color: white;
		font-weight: bold;
	}
	.icon-wrapper.blue {
		background: var(--gradient-blue);
	}
	.icon-wrapper.purple {
		background: var(--gradient-purple);
	}
	.icon-wrapper.green {
		background: var(--gradient-green);
	}
	.icon-wrapper.indigo {
		background: var(--gradient-indigo);
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
		color: var(--text-primary);
	}
	.pref-desc {
		font-size: 0.9rem;
		color: var(--text-secondary);
	}

	.theme-toggle-btn {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 1rem;
		background: var(--bg-primary);
		border: 1px solid var(--border);
		border-radius: 99px;
		color: var(--text-primary);
		cursor: pointer;
		font-weight: 500;
		transition: all 0.2s;
	}
	.theme-toggle-btn:hover {
		border-color: var(--accent);
		color: var(--accent);
	}

	.lang-select {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.4rem 0.75rem;
		background: var(--bg-primary);
		border: 1px solid var(--border);
		border-radius: 99px;
		color: var(--text-primary);
	}
	.lang-select select {
		background: transparent;
		border: none;
		outline: none;
		color: var(--text-primary);
		font-weight: 500;
		font-family: inherit;
		cursor: pointer;
		padding-right: 0.25rem;
	}

	.preference-row + .preference-row {
		margin-top: 1.25rem;
		padding-top: 1.25rem;
		border-top: 1px solid var(--border);
	}

	.admin-link-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		text-decoration: none;
		color: var(--text-primary);
	}
	.admin-link-row:hover {
		color: var(--accent);
	}
	.admin-link-row:hover .pref-title {
		color: var(--accent);
	}

	.info-box {
		display: flex;
		gap: 0.75rem;
		background: rgba(59, 130, 246, 0.1);
		color: var(--text-primary);
		padding: 1rem;
		border-radius: var(--radius-md);
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
		color: var(--accent);
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.status-success {
		color: var(--success);
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-weight: 500;
	}
	.status-error {
		color: var(--error);
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-weight: 500;
	}
	.status-warning {
		color: var(--warning);
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
		color: var(--text-secondary);
		font-size: 0.9rem;
	}

	/* --- FORMS & INPUTS --- */
	.settings-input {
		padding: 0.75rem 1rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-xs);
		background: var(--bg-primary);
		color: var(--text-primary);
		outline: none;
		transition: border-color 0.2s;
	}
	.settings-input:focus {
		border-color: var(--accent);
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
		background: var(--bg-secondary);
		border: 1px solid var(--border);
		border-top: none;
		border-radius: 0 0 var(--radius-xs) var(--radius-xs);
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
		color: var(--text-secondary);
		justify-content: center;
	}

	.dropdown-item {
		width: 100%;
		padding: 0.75rem 1rem;
		border: none;
		background: none;
		text-align: left;
		cursor: pointer;
		color: var(--text-primary);
		font-size: 0.95rem;
		transition: background-color 0.2s;
	}

	.dropdown-item:hover:not(:disabled) {
		background: var(--bg-primary);
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
		color: var(--text-primary);
	}

	.user-item-meta {
		font-size: 0.85rem;
		color: var(--text-secondary);
	}

	.permission-add-row input {
		flex: 1;
	}

	/* Inline retry action inside face-detection status boxes. */
	.retry-link {
		margin-top: 0.5rem;
		align-self: flex-start;
		background: none;
		border: none;
		padding: 0;
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--accent);
		cursor: pointer;
	}
	.retry-link:hover {
		color: var(--accent-hover);
		text-decoration: underline;
	}

	/* --- PERSON LIST (shared by "authorized people" and "shared with me") --- */
	.person-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.person-row {
		display: flex;
		align-items: center;
		gap: 0.85rem;
		padding: 0.6rem 0.75rem;
		background: var(--bg-primary);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		text-decoration: none;
		transition: all 0.2s var(--ease);
	}
	.person-row-link:hover {
		border-color: var(--accent);
		transform: translateX(2px);
	}
	.person-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		line-height: 1.25;
	}
	.person-name {
		font-size: 0.95rem;
		font-weight: 600;
		color: var(--text-primary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.person-meta {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.78rem;
		color: var(--text-secondary);
	}
	.person-promo {
		padding: 0.05rem 0.4rem;
		border-radius: 99px;
		background: var(--accent-light);
		color: var(--accent);
		font-weight: 600;
	}
	.person-action-btn {
		flex-shrink: 0;
		background: none;
		border: none;
		cursor: pointer;
		color: var(--text-secondary);
		padding: 6px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.15s var(--ease);
	}
	.person-action-btn:hover {
		background: color-mix(in srgb, var(--error) 15%, transparent);
		color: var(--error);
	}
	.person-chevron {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		color: var(--text-muted);
	}

	/* --- DANGER ZONE --- */
	.danger-zone {
		border-color: var(--st-danger-border);
		background: var(--st-danger-bg);
	}
	.danger-info strong {
		color: var(--text-primary);
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


	/* --- FOOTER --- */
	.settings-footer {
		text-align: center;
		margin-top: 4rem;
		color: var(--text-secondary);
	}
	.footer-links a:hover {
		color: var(--accent);
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
