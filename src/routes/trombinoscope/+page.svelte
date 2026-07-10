<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount, onDestroy } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import {
		Download,
		UserPlus,
		XCircle,
		Users,
		Search,
		Pencil,
		Trash2,
		Camera,
		CheckCircle,
		UploadCloud,
		Check,
		ChevronDown,
		UserCheck,
		Funnel,
		GraduationCap,
		BookOpen
	} from 'lucide-svelte';
	import Spinner from '$lib/components/Spinner.svelte';
	import BackgroundBlobs from '$lib/components/BackgroundBlobs.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import type { User } from '$lib/types/api';
	import { showConfirm } from '$lib/confirm';
	import { toast } from '$lib/toast';
	import { fuzzyMatch } from '$lib/fuzzy';
	import { uploadFileChunked } from '$lib/album-operations';
	import jsPDF from 'jspdf';

	let loading = $state(false);
	let error = $state<string | null>(null);
	let users = $state<User[]>([]);
	let searchQuery = $state<string>('');
	let groupBy = $state<'promo' | 'formation'>('promo');

	// PDF export modal state
	let showPdfModal = $state(false);
	let pdfSelectedPromos = $state<string[]>([]);
	let pdfSelectedFormations = $state<string[]>([]);

	function promoKey(u: User): string {
		return u.promo ? u.promo.toString() : 'Staff / Autre';
	}
	function formationKey(u: User): string {
		return u.formation || 'Sans formation';
	}

	function sortByLastName(arr: User[]): User[] {
		return [...arr].sort((a, b) => {
			const la = (a.last_name || a.name || '').toLowerCase();
			const lb = (b.last_name || b.name || '').toLowerCase();
			const cmp = la.localeCompare(lb, 'fr');
			if (cmp !== 0) return cmp;
			return (a.first_name || '')
				.toLowerCase()
				.localeCompare((b.first_name || '').toLowerCase(), 'fr');
		});
	}

	let filteredUsers = $derived.by(() => {
		if (!searchQuery.trim()) return users;
		return users.filter((u) => {
			const hay = `${u.name || ''} ${u.first_name || ''} ${u.last_name || ''} ${u.formation || ''} ${u.promo ?? ''}`;
			return fuzzyMatch(searchQuery, hay);
		});
	});

	let availablePromos = $derived(
		[...new Set(users.map(promoKey))].sort((a, b) => {
			if (a === 'Staff / Autre') return 1;
			if (b === 'Staff / Autre') return -1;
			return Number(b) - Number(a);
		})
	);

	let availableFormations = $derived(
		[...new Set(users.map(formationKey))].sort((a, b) => {
			if (a === 'Sans formation') return 1;
			if (b === 'Sans formation') return -1;
			return a.localeCompare(b, 'fr');
		})
	);

	let groupedAndSortedUsers = $derived.by(() => {
		const sorted = sortByLastName(filteredUsers);
		const grouped: Record<string, User[]> = {};
		for (const user of sorted) {
			const key = groupBy === 'promo' ? promoKey(user) : formationKey(user);
			if (!grouped[key]) grouped[key] = [];
			grouped[key].push(user);
		}
		return grouped;
	});

	let sortedGroupEntries = $derived.by(() =>
		Object.entries(groupedAndSortedUsers).sort(([a], [b]) => {
			if (groupBy === 'promo') {
				if (a === 'Staff / Autre') return 1;
				if (b === 'Staff / Autre') return -1;
				return Number(b) - Number(a);
			} else {
				if (a === 'Sans formation') return 1;
				if (b === 'Sans formation') return -1;
				return a.localeCompare(b, 'fr');
			}
		})
	);

	let pdfSelectedCount = $derived.by(() => {
		const promoSet = new Set(pdfSelectedPromos);
		const formationSet = new Set(pdfSelectedFormations);
		return users.filter((u) => promoSet.has(promoKey(u)) && formationSet.has(formationKey(u)))
			.length;
	});

	let showEditUserModal = $state(false);
	let editMode = $state<'add' | 'edit'>('add');
	let editUserData = $state({
		id_user: '',
		name: '',
		first_name: '',
		last_name: '',
		formation: null as string | null,
		role: 'user',
		promo: null as number | null,
		photos_id: null as string | null
	});
	let selectedUser = $state<User | null>(null);

	let uploadingPhoto = $state(false);
	let uploadPhotoFile = $state<File | null>(null);

	let userRole = $derived((page.data.session?.user as User)?.role || 'user');
	let currentUserId = $derived((page.data.session?.user as User)?.id_user);
	let canAccess = $derived(userRole === 'admin');

	function openPdfModal() {
		pdfSelectedPromos = [...availablePromos];
		pdfSelectedFormations = [...availableFormations];
		showPdfModal = true;
	}

	function togglePromo(promo: string) {
		if (pdfSelectedPromos.includes(promo)) {
			pdfSelectedPromos = pdfSelectedPromos.filter((p) => p !== promo);
		} else {
			pdfSelectedPromos = [...pdfSelectedPromos, promo];
		}
	}

	function toggleFormation(f: string) {
		if (pdfSelectedFormations.includes(f)) {
			pdfSelectedFormations = pdfSelectedFormations.filter((x) => x !== f);
		} else {
			pdfSelectedFormations = [...pdfSelectedFormations, f];
		}
	}

	function startPdfExport() {
		const promoSet = new Set(pdfSelectedPromos);
		const formationSet = new Set(pdfSelectedFormations);
		const usersToExport = sortByLastName(
			users.filter((u) => promoSet.has(promoKey(u)) && formationSet.has(formationKey(u)))
		);
		exportToPDF(usersToExport);
	}

	async function exportToPDF(usersToExport: User[]) {
		showPdfModal = false;
		if (usersToExport.length === 0) {
			toast.info('Aucun utilisateur à exporter');
			return;
		}

		const toastId = toast.loading('Génération du PDF...');
		try {
			const doc = new jsPDF();

			doc.setFontSize(18);
			doc.text('Trombinoscope MiGallery', 14, 22);
			doc.setFontSize(11);
			doc.setTextColor(100);

			const images: Record<string, string> = {};
			const loadImage = async (userId: string) => {
				try {
					const res = await fetch(`/api/users/${userId}/avatar`);
					if (!res.ok) return null;
					const blob = await res.blob();
					return new Promise<string>((resolve) => {
						const reader = new FileReader();
						reader.onloadend = () => resolve(reader.result as string);
						reader.readAsDataURL(blob);
					});
				} catch {
					return null;
				}
			};

			await Promise.all(
				usersToExport.map(async (u) => {
					const dataUrl = await loadImage(u.id_user);
					if (dataUrl) images[u.id_user] = dataUrl;
				})
			);

			const usersByPromo: Record<string, User[]> = {};
			usersToExport.forEach((u) => {
				const p = promoKey(u);
				if (!usersByPromo[p]) usersByPromo[p] = [];
				usersByPromo[p].push(u);
			});

			const promos = Object.keys(usersByPromo).sort((a, b) => {
				if (a === 'Staff / Autre') return 1;
				if (b === 'Staff / Autre') return -1;
				return Number(b) - Number(a);
			});

			let y = 40;
			const margin = 15;
			const pageWidth = doc.internal.pageSize.getWidth();
			const contentWidth = pageWidth - margin * 2;
			const colCount = 5;
			const colWidth = contentWidth / colCount;
			const imgSize = 25;
			const rowHeight = 45;

			promos.forEach((promo) => {
				if (y + 20 > doc.internal.pageSize.getHeight() - margin) {
					doc.addPage();
					y = margin + 10;
				}

				doc.setFontSize(16);
				doc.setTextColor(0);
				doc.setFont('helvetica', 'bold');
				doc.text(promo === 'Staff / Autre' ? promo : `Promo ${promo}`, margin, y);
				y += 10;

				const promoUsers = usersByPromo[promo];

				for (let i = 0; i < promoUsers.length; i += colCount) {
					if (y + rowHeight > doc.internal.pageSize.getHeight() - margin) {
						doc.addPage();
						y = margin + 10;
					}

					const rowUsers = promoUsers.slice(i, i + colCount);
					rowUsers.forEach((user, idx) => {
						const x = margin + idx * colWidth;
						const img = images[user.id_user];

						const imgX = x + (colWidth - imgSize) / 2;
						if (img) {
							try {
								doc.addImage(img, 'JPEG', imgX, y, imgSize, imgSize);
							} catch (e) {
								/* ignore */
							}
						} else {
							doc.setDrawColor(220);
							doc.setFillColor('#f0f0f0');
							doc.rect(imgX, y, imgSize, imgSize, 'FD');
						}

						doc.setFontSize(9);
						doc.setFont('helvetica', 'normal');
						doc.setTextColor(60);
						const name =
							user.name || `${user.first_name || ''} ${user.last_name || ''}`.trim();
						doc.text(name, x + colWidth / 2, y + imgSize + 5, { align: 'center' });
					});

					y += rowHeight;
				}

				y += 5;
			});

			doc.save('trombinoscope.pdf');
			toast.dismiss(toastId);
			toast.success('PDF téléchargé !');
		} catch (e) {
			console.error(e);
			toast.dismiss(toastId);
			toast.error('Erreur lors de la génération du PDF');
		}
	}

	async function fetchUsers() {
		loading = true;
		error = null;
		users = [];

		try {
			const res = await fetch('/api/users');
			if (!res.ok) {
				const errText = await res.text().catch(() => res.statusText);
				throw new Error(errText || 'Erreur lors du chargement');
			}
			const data = (await res.json()) as { users: User[] };
			users = data.users || [];
		} catch (e: unknown) {
			error = (e as Error).message;
		} finally {
			loading = false;
		}
	}

	function handleUserClick(userId: string) {
		goto(`/mes-photos?userId=${userId}`);
	}

	function getUserInitials(user: User): string {
		const firstName = user.first_name || '';
		const lastName = user.last_name || '';
		return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
	}

	function openAddUserModal() {
		editMode = 'add';
		editUserData = {
			id_user: '',
			name: '',
			first_name: '',
			last_name: '',
			formation: null,
			role: 'user',
			promo: null,
			photos_id: null
		};
		uploadPhotoFile = null;
		showEditUserModal = true;
	}

	function openEditUserModal(user: User, e: MouseEvent) {
		e.stopPropagation();
		editMode = 'edit';
		editUserData = {
			id_user: user.id_user,
			name: user.name || '',
			first_name: user.first_name || '',
			last_name: user.last_name || '',
			formation: user.formation || null,
			role: user.role || 'user',
			promo: user.promo || null,
			photos_id: user.photos_id || null
		};
		uploadPhotoFile = null;
		selectedUser = user;
		showEditUserModal = true;
	}

	async function saveUser() {
		if (!editUserData.id_user || !editUserData.first_name || !editUserData.last_name) {
			toast.error('Les champs ID, prénom et nom sont requis.');
			return;
		}

		try {
			let finalIdPhotos = editUserData.photos_id;

			if (uploadPhotoFile) {
				uploadingPhoto = true;
				let uploadRes: Response;

				uploadRes = await uploadFileChunked(uploadPhotoFile);

				if (!uploadRes.ok) throw new Error("Erreur lors de l'upload de la photo");

				const uploadData = (await uploadRes.json()) as { id: string };
				const assetId = uploadData.id;
				if (!assetId) throw new Error('Asset ID non récupéré après upload');

				const maxAttempts = 15;
				let attempt = 0;
				let faceDetected = false;
				let people: { id: string }[] = [];

				while (attempt < maxAttempts && !faceDetected) {
					await new Promise((resolve) => setTimeout(resolve, 1000));
					attempt++;
					try {
						const checkResponse = await fetch(
							`/api/immich/assets/${assetId}?nocache=${Date.now()}`
						);
						if (checkResponse.ok) {
							const checkData = await checkResponse.json();
							const checkInfo = checkData as { people?: { id: string }[] };
							if (checkInfo.people && checkInfo.people.length > 0) {
								faceDetected = true;
								people = checkInfo.people;
								break;
							}
						}
					} catch (pollError) {
						console.warn('Polling error:', pollError);
					}
				}

				if (people.length === 0) {
					uploadingPhoto = false;
					toast.error('Aucune personne détectée. Choisissez une photo avec un visage visible.');
					return;
				}
				if (people.length > 1) {
					uploadingPhoto = false;
					toast.error(
						`Plusieurs personnes détectées (${people.length}). Choisissez une photo avec une seule personne.`
					);
					return;
				}
				finalIdPhotos = people[0].id;
				uploadingPhoto = false;
			}

			const method = editMode === 'add' ? 'POST' : 'PUT';
			const url =
				editMode === 'add'
					? '/api/users'
					: `/api/users/${encodeURIComponent(editUserData.id_user)}`;

			const res = await fetch(url, {
				method,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ...editUserData, photos_id: finalIdPhotos })
			});

			if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));

			await fetchUsers();
			showEditUserModal = false;
			selectedUser = null;
			uploadPhotoFile = null;
			toast.success(editMode === 'add' ? 'Utilisateur ajouté' : 'Utilisateur modifié');
		} catch (e: unknown) {
			uploadingPhoto = false;
			toast.error('Erreur: ' + (e as Error).message);
		}
	}

	async function deleteUserConfirm(user: User, event: MouseEvent) {
		event.stopPropagation();
		if (user.id_user === currentUserId) {
			toast.error('Vous ne pouvez pas supprimer votre propre compte.');
			return;
		}
		const ok = await showConfirm(`Supprimer ${user.name} ?`, "Supprimer l'utilisateur");
		if (!ok) return;

		try {
			const res = await fetch(`/api/users/${encodeURIComponent(user.id_user)}`, {
				method: 'DELETE'
			});
			if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
			await fetchUsers();
			toast.success('Utilisateur supprimé');
		} catch (e: unknown) {
			toast.error('Erreur: ' + (e as Error).message);
		}
	}

	onMount(() => {
		fetchUsers();
	});
</script>

<svelte:head>
	<title>Trombinoscope - MiGallery</title>
</svelte:head>

<main class="trombi-main">
	<BackgroundBlobs />

	<div class="trombi-container">
		<!-- Header -->
		<header class="page-header" in:fade={{ duration: 300, delay: 100 }}>
			<div class="header-content">
				<h1>Trombinoscope</h1>
				<p class="subtitle">L'annuaire des membres de la galerie</p>
			</div>

			<div class="header-search">
				<input
					class="search-input"
					placeholder="Rechercher (prénom, nom, formation...)"
					bind:value={searchQuery}
					oninput={(e) => {
						searchQuery = (e.target as HTMLInputElement).value;
					}}
					aria-label="Rechercher des membres"
				/>
			</div>

			<div class="group-tabs">
				<button
					class="group-tab {groupBy === 'promo' ? 'active' : ''}"
					type="button"
					onclick={() => (groupBy = 'promo')}
				>
					<GraduationCap size={15} />
					Par promotion
				</button>
				<button
					class="group-tab {groupBy === 'formation' ? 'active' : ''}"
					type="button"
					onclick={() => (groupBy = 'formation')}
				>
					<BookOpen size={15} />
					Par formation
				</button>
			</div>

			<div class="header-actions">
				<button class="action-pill" type="button" onclick={openPdfModal} title="Exporter en PDF">
					<Download size={18} />
					<span>PDF</span>
				</button>
				{#if canAccess}
					<button class="action-pill primary" type="button" onclick={openAddUserModal}>
						<UserPlus size={18} />
						<span>Ajouter</span>
					</button>
				{/if}
			</div>
		</header>

		{#if error}
			<div class="state-message error" in:fade>
				<XCircle size={24} />
				{error}
			</div>
		{/if}

		{#if loading}
			<div class="state-message loading" in:fade>
				<Spinner size={32} /> Chargement de l'annuaire...
			</div>
		{/if}

		{#if !loading && !error && users.length === 0}
			<div in:fade>
				<EmptyState icon={Users} title="Aucun utilisateur trouvé" />
			</div>
		{/if}

		{#if users.length > 0}
			{#if filteredUsers.length === 0}
				<div in:fade>
					<EmptyState icon={Search} title="Aucun membre ne correspond à votre recherche" />
				</div>
			{:else}
				<div class="content-area">
					{#each sortedGroupEntries as [groupKey, groupUsers], i}
						<section class="promo-section" in:fade={{ delay: i * 100, duration: 400 }}>
							<div class="section-header">
								<h2>
									{groupBy === 'promo' && groupKey !== 'Staff / Autre'
										? `Promo ${groupKey}`
										: groupKey}
								</h2>
								<span class="count-badge">{groupUsers.length}</span>
							</div>

							<div class="users-grid">
								{#each groupUsers as user (user.id_user)}
									<div
										class="user-card"
										role="button"
										tabindex="0"
										onclick={() => handleUserClick(user.id_user)}
										onkeydown={(e) => {
											if (e.key === 'Enter' || e.key === ' ') handleUserClick(user.id_user);
										}}
									>
										<div class="card-glow"></div>

										{#if canAccess}
											<div class="admin-controls">
												<button
													class="control-btn edit"
													type="button"
													onclick={(e) => openEditUserModal(user, e)}
													title="Éditer"
												>
													<Pencil />
												</button>
												<button
													class="control-btn delete"
													type="button"
													onclick={(e) => deleteUserConfirm(user, e)}
													title="Supprimer"
												>
													<Trash2 />
												</button>
											</div>
										{/if}

										<div class="avatar-container">
											{#if user.photos_id}
												<img
													src={`/api/immich/people/${user.photos_id}/thumbnail`}
													alt={user.name}
													loading="lazy"
													onerror={(e) => {
														const target = e.currentTarget as HTMLImageElement;
														target.style.display = 'none';
														target.nextElementSibling?.classList.remove('hidden');
													}}
												/>
												<div class="avatar-fallback hidden">{getUserInitials(user)}</div>
											{:else}
												<div class="avatar-fallback">{getUserInitials(user)}</div>
											{/if}
										</div>

										<div class="user-info">
											<div class="name">{user.name}</div>
											<div class="username" title="@{user.id_user}">@{user.id_user}</div>
											{#if user.role && user.role !== 'user'}
												<div class="role-tag {user.role}">{user.role}</div>
											{/if}
										</div>
									</div>
								{/each}
							</div>
						</section>
					{/each}
				</div>
			{/if}
		{/if}
	</div>

	<!-- PDF Export Modal -->
	{#if showPdfModal}
		<div
			class="modal-backdrop"
			onclick={() => (showPdfModal = false)}
			role="presentation"
			transition:fade={{ duration: 200 }}
		>
			<div
				class="modal-glass pdf-modal"
				onclick={(e) => e.stopPropagation()}
				onkeydown={(e) => {
					if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
				}}
				tabindex="0"
				role="dialog"
				transition:fly={{ y: 20, duration: 300 }}
			>
				<div class="modal-header">
					<h3><Funnel size={20} /> Exporter en PDF</h3>
				</div>

				<div class="modal-body">
					<div class="pdf-filters">
						<div class="pdf-filter-col">
							<div class="pdf-filter-heading">
								<GraduationCap size={15} />
								<span>Promotions</span>
								<div class="quick-btns">
									<button type="button" onclick={() => (pdfSelectedPromos = [...availablePromos])}>Tout</button>
									<button type="button" onclick={() => (pdfSelectedPromos = [])}>Rien</button>
								</div>
							</div>
							<div class="checkbox-list">
								{#each availablePromos as promo}
									<label class="checkbox-item">
										<input
											type="checkbox"
											checked={pdfSelectedPromos.includes(promo)}
											onchange={() => togglePromo(promo)}
										/>
										<span>{promo}</span>
									</label>
								{/each}
							</div>
						</div>

						<div class="pdf-filter-col">
							<div class="pdf-filter-heading">
								<BookOpen size={15} />
								<span>Formations</span>
								<div class="quick-btns">
									<button type="button" onclick={() => (pdfSelectedFormations = [...availableFormations])}
										>Tout</button
									>
									<button type="button" onclick={() => (pdfSelectedFormations = [])}>Rien</button>
								</div>
							</div>
							<div class="checkbox-list">
								{#each availableFormations as formation}
									<label class="checkbox-item">
										<input
											type="checkbox"
											checked={pdfSelectedFormations.includes(formation)}
											onchange={() => toggleFormation(formation)}
										/>
										<span>{formation}</span>
									</label>
								{/each}
							</div>
						</div>
					</div>

					<p class="export-count">
						{pdfSelectedCount} utilisateur{pdfSelectedCount !== 1 ? 's' : ''} sélectionné{pdfSelectedCount !== 1 ? 's' : ''}
					</p>
				</div>

				<div class="modal-actions">
					<button class="btn-text" type="button" onclick={() => (showPdfModal = false)}>Annuler</button>
					<button
						class="action-pill primary"
						type="button"
						onclick={startPdfExport}
						disabled={pdfSelectedCount === 0}
					>
						<Download size={16} />
						Exporter
					</button>
				</div>
			</div>
		</div>
	{/if}

	<!-- Edit/Add User Modal -->
	{#if showEditUserModal}
		<div
			class="modal-backdrop"
			onclick={() => (showEditUserModal = false)}
			role="presentation"
			transition:fade={{ duration: 200 }}
		>
			<div
				class="modal-glass"
				onclick={(e) => e.stopPropagation()}
				onkeydown={(e) => {
					if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
				}}
				tabindex="0"
				role="dialog"
				transition:fly={{ y: 20, duration: 300 }}
			>
				<div class="modal-header">
					<h3>
						{#if editMode === 'add'}
							<UserPlus size={24} />
						{:else}
							<UserCheck size={24} />
						{/if}
						{editMode === 'add' ? 'Nouvel utilisateur' : 'Édition'}
					</h3>
				</div>

				<div class="modal-body">
					<div class="form-grid">
						<div class="input-group">
							<label for="id_user">Identifiant *</label>
							<input
								id="id_user"
								class="input-glass"
								bind:value={editUserData.id_user}
								disabled={editMode === 'edit'}
								placeholder="ex: p.nom"
							/>
						</div>
						<div class="input-group">
							<label for="name">Nom complet</label>
							<input
								id="name"
								class="input-glass"
								bind:value={editUserData.name}
								placeholder="Prénom NOM"
							/>
						</div>
						<div class="input-group">
							<label for="first_name">Prénom *</label>
							<input id="first_name" class="input-glass" bind:value={editUserData.first_name} />
						</div>
						<div class="input-group">
							<label for="last_name">Nom *</label>
							<input id="last_name" class="input-glass" bind:value={editUserData.last_name} />
						</div>
						<div class="input-group">
							<label for="formation">Formation</label>
							<input
								id="formation"
								class="input-glass"
								bind:value={editUserData.formation}
								placeholder="ex: ICM, DevOps..."
							/>
							<label for="role">Rôle</label>
							<div class="select-wrapper">
								<select
									id="role"
									class="input-glass"
									bind:value={editUserData.role}
									disabled={editMode === 'edit' && editUserData.id_user === currentUserId}
								>
									<option value="user">Utilisateur</option>
									<option value="mitviste">Mitviste</option>
									<option value="admin">Admin</option>
								</select>
								<div class="select-icon"><ChevronDown size={14} /></div>
							</div>
						</div>
					</div>

					<div class="photo-section">
						<div class="photo-header">
							<Camera size={18} /> Liaison Photo (Immich)
						</div>
						<div class="photo-content">
							{#if editUserData.photos_id}
								<div class="photo-status success">
									<CheckCircle size={16} />
									<span
										>Lié : <code class="code-pill"
											>{editUserData.photos_id.substring(0, 8)}...</code
										></span
									>
								</div>
							{/if}
							<label class="file-upload-btn {uploadingPhoto ? 'disabled' : ''}">
								<input
									type="file"
									accept="image/*"
									onchange={(e) => {
										const target = e.target as HTMLInputElement;
										uploadPhotoFile = target.files?.[0] || null;
									}}
									disabled={uploadingPhoto}
								/>
								{#if uploadingPhoto}
									<Spinner size={16} /> Analyse...
								{:else}
									<UploadCloud size={16} />
									{uploadPhotoFile
										? uploadPhotoFile.name
										: editUserData.photos_id
											? 'Remplacer photo'
											: 'Uploader photo'}
								{/if}
							</label>
						</div>
						<p class="photo-hint">
							L'upload déclenche une reconnaissance faciale pour associer le profil.
						</p>
					</div>
				</div>

				<div class="modal-actions">
					<button
						class="btn-text"
						type="button"
						onclick={() => (showEditUserModal = false)}
						disabled={uploadingPhoto}>Annuler</button
					>
					<button class="action-pill primary" type="button" onclick={saveUser} disabled={uploadingPhoto}>
						{#if uploadingPhoto}
							<Spinner size={16} />
						{:else}
							<Check size={16} />
						{/if}
						{editMode === 'add' ? 'Créer' : 'Sauvegarder'}
					</button>
				</div>
			</div>
		</div>
	{/if}
</main>

<style>
	/* Uses the global theme tokens directly (no per-page mirror variables). */
	.trombi-main {
		position: relative;
		min-height: 100vh;
		padding: 4rem 0 6rem;
		color: var(--text-primary);
		overflow-x: hidden;
	}

	.trombi-container {
		position: relative;
		z-index: 1;
		max-width: 1200px;
		margin: 0 auto;
		padding: 2rem 1.5rem 6rem;
	}

	.header-search {
		margin-top: 0.75rem;
		width: 100%;
		max-width: 520px;
	}
	.search-input {
		width: 100%;
		padding: 0.5rem 0.75rem;
		border-radius: var(--radius-sm);
		border: 1px solid var(--border);
		background: var(--bg-secondary);
		color: var(--text-primary);
	}
	.search-input:focus {
		outline: none;
		box-shadow: 0 6px 18px color-mix(in srgb, var(--accent) 8%, transparent);
		border-color: var(--accent);
	}

	/* --- HEADER --- */
	.page-header {
		text-align: center;
		margin-bottom: 3rem;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
	}
	.subtitle {
		color: var(--text-secondary);
		font-size: 1.1rem;
		margin: 0;
	}
	.header-actions {
		margin-top: 1.5rem;
		display: flex;
		gap: 0.75rem;
	}

	/* Group tabs */
	.group-tabs {
		display: flex;
		gap: 0.5rem;
		margin-top: 0.75rem;
	}
	.group-tab {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.4rem 0.9rem;
		border-radius: 99px;
		border: 1px solid var(--border);
		background: transparent;
		color: var(--text-secondary);
		cursor: pointer;
		font-size: 0.85rem;
		font-weight: 600;
		transition: all 0.2s;
	}
	.group-tab.active {
		background: var(--accent);
		border-color: var(--accent);
		color: white;
	}
	.group-tab:hover:not(.active) {
		border-color: var(--accent);
		color: var(--accent);
	}

	.action-pill {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.6rem 1.5rem;
		border-radius: 99px;
		border: none;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
		font-size: 0.95rem;
		box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
	}
	.action-pill.primary {
		background: var(--accent);
		color: white;
	}
	.action-pill.primary:hover {
		transform: translateY(-2px);
		box-shadow: 0 10px 15px -3px color-mix(in srgb, var(--accent) 40%, transparent);
	}
	.action-pill:disabled {
		opacity: 0.7;
		cursor: not-allowed;
		transform: none;
	}

	/* --- STATES --- */
	.state-message {
		padding: 3rem;
		text-align: center;
		color: var(--text-secondary);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
		background: var(--bg-secondary);
		border-radius: 1rem;
		border: 1px solid var(--border);
	}
	.state-message.error {
		color: var(--error);
		border-color: color-mix(in srgb, var(--error) 20%, transparent);
		background: color-mix(in srgb, var(--error) 5%, transparent);
	}
	/* --- CONTENT GRID --- */
	.promo-section {
		margin-bottom: 4rem;
	}
	.section-header {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-bottom: 1.5rem;
		padding-bottom: 0.5rem;
		border-bottom: 1px solid var(--border);
	}
	.section-header h2 {
		font-size: 1.5rem;
		margin: 0;
		color: var(--text-primary);
		font-weight: 700;
		letter-spacing: -0.01em;
	}
	.count-badge {
		background: var(--accent);
		color: white;
		opacity: 0.2;
		padding: 0.2rem 0.6rem;
		border-radius: var(--radius-md);
		font-size: 0.8rem;
		font-weight: 700;
	}

	.users-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: 1.5rem;
	}

	/* --- USER CARD (Glassmorphism) --- */
	.user-card {
		position: relative;
		background: var(--bg-secondary);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		border: 1px solid var(--glass-border);
		border-radius: var(--radius-lg);
		padding: 2rem 1.5rem;
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
		cursor: pointer;
		overflow: hidden;
	}

	.user-card:hover {
		transform: translateY(-5px);
		box-shadow: 0 20px 40px -5px rgba(0, 0, 0, 0.1);
		border-color: var(--accent);
	}

	.card-glow {
		position: absolute;
		inset: 0;
		background: radial-gradient(circle at top, rgba(255, 255, 255, 0.1), transparent 70%);
		pointer-events: none;
	}

	/* Admin Controls on Card */
	.admin-controls {
		position: absolute;
		top: 10px;
		right: 10px;
		display: flex;
		gap: 5px;
		opacity: 0;
		transition: opacity 0.2s;
		z-index: 2;
	}
	.user-card:hover .admin-controls {
		opacity: 1;
	}

	.control-btn {
		width: 32px;
		height: 32px;
		border-radius: var(--radius-xs);
		border: none;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		backdrop-filter: blur(4px);
		transition: all 0.2s;
	}
	.control-btn :global(svg) {
		width: 20px !important;
		height: 20px !important;
		min-width: 20px !important;
		min-height: 20px !important;
	}
	.control-btn.edit {
		background: color-mix(in srgb, var(--accent) 20%, transparent);
		color: var(--accent);
	}
	.control-btn.edit:hover {
		background: var(--accent);
		color: white;
	}
	.control-btn.delete {
		background: color-mix(in srgb, var(--error) 20%, transparent);
		color: var(--error);
	}
	.control-btn.delete:hover {
		background: var(--error);
		color: white;
	}

	/* Avatar */
	.avatar-container {
		width: 110px;
		height: 110px;
		border-radius: 50%;
		margin-bottom: 1.2rem;
		position: relative;
		z-index: 1;
		border: 4px solid var(--bg-secondary);
		box-shadow: 0 8px 20px rgba(0, 0, 0, 0.1);
		background: var(--border);
		overflow: hidden;
		transition: border-color 0.3s;
	}
	.user-card:hover .avatar-container {
		border-color: var(--accent);
	}

	.avatar-container img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.avatar-fallback {
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 2.5rem;
		font-weight: 700;
		color: var(--text-secondary);
		background: var(--bg-primary);
	}
	.hidden {
		display: none;
	}

	/* User Info */
	.user-info {
		position: relative;
		z-index: 1;
		width: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.25rem;
	}

	.name {
		font-weight: 700;
		font-size: 1.15rem;
		color: var(--text-primary);
		margin-bottom: 0.1rem;
		line-height: 1.2;
	}
	.username {
		font-family: monospace;
		font-size: 0.85rem;
		color: var(--text-secondary);
		opacity: 0.8;
		max-width: 100%;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		margin-bottom: 0.5rem;
	}

	.role-tag {
		font-size: 0.7rem;
		font-weight: 800;
		padding: 0.2rem 0.6rem;
		border-radius: 6px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin-top: 0.2rem;
	}
	.role-tag.admin {
		background: color-mix(in srgb, var(--accent) 15%, transparent);
		color: var(--accent);
	}
	.role-tag.mitviste {
		background: color-mix(in srgb, var(--pink) 15%, transparent);
		color: var(--pink);
	}

	/* --- MODAL --- */
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.7);
		backdrop-filter: blur(8px);
		z-index: 100;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
	}
	.modal-glass {
		background: var(--bg-secondary);
		width: 90%;
		max-width: 520px;
		padding: 1.75rem;
		border-radius: 18px;
		border: 1px solid var(--glass-border);
		box-shadow: 0 20px 50px rgba(2, 6, 23, 0.6);
		text-align: center;
		position: relative;
		overflow: hidden;
		backdrop-filter: blur(8px) saturate(120%);
		max-height: 90vh;
		display: flex;
		flex-direction: column;
	}
	.modal-glass.pdf-modal {
		max-width: 560px;
		text-align: left;
	}
	.modal-header {
		padding: 1.5rem;
		border-bottom: 1px solid var(--border);
		background: rgba(255, 255, 255, 0.02);
		flex-shrink: 0;
	}
	.modal-header h3 {
		margin: 0;
		font-size: 1.2rem;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		color: var(--text-primary);
	}

	.modal-body {
		padding: 2rem;
		overflow-y: auto;
		flex: 1;
	}
	.modal-actions {
		padding: 1.5rem;
		border-top: 1px solid var(--border);
		background: rgba(255, 255, 255, 0.02);
		display: flex;
		justify-content: flex-end;
		gap: 1rem;
		flex-shrink: 0;
	}

	/* PDF Filter Modal */
	.pdf-filters {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1.5rem;
		margin-bottom: 1.25rem;
	}
	.pdf-filter-col {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.pdf-filter-heading {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.85rem;
		font-weight: 700;
		color: var(--text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.quick-btns {
		margin-left: auto;
		display: flex;
		gap: 0.35rem;
	}
	.quick-btns button {
		background: transparent;
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 0.1rem 0.45rem;
		font-size: 0.75rem;
		color: var(--text-secondary);
		cursor: pointer;
		transition: all 0.15s;
	}
	.quick-btns button:hover {
		border-color: var(--accent);
		color: var(--accent);
	}
	.checkbox-list {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		max-height: 200px;
		overflow-y: auto;
		padding-right: 0.25rem;
	}
	.checkbox-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.9rem;
		color: var(--text-primary);
		cursor: pointer;
		padding: 0.3rem 0.5rem;
		border-radius: var(--radius-xs);
		transition: background 0.15s;
	}
	.checkbox-item:hover {
		background: color-mix(in srgb, var(--accent) 7%, transparent);
	}
	.checkbox-item input[type='checkbox'] {
		accent-color: var(--accent);
		width: 15px;
		height: 15px;
		flex-shrink: 0;
	}
	.export-count {
		font-size: 0.85rem;
		color: var(--text-secondary);
		text-align: right;
		margin: 0;
		font-style: italic;
	}

	/* Form Elements */
	.form-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 1.2rem;
		margin-bottom: 2rem;
	}
	.input-group {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.input-group label {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--text-secondary);
		margin-left: 2px;
	}

	.input-glass {
		padding: 0.75rem 1rem;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		font-size: 0.95rem;
		color: var(--text-primary);
		width: 100%;
		transition: all 0.2s;
	}
	.input-glass:focus {
		outline: none;
		border-color: var(--accent);
		background: rgba(255, 255, 255, 0.05);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 15%, transparent);
	}
	.input-glass:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.select-wrapper {
		position: relative;
	}
	.select-wrapper select {
		appearance: none;
		cursor: pointer;
		background: transparent;
		color: var(--text-primary);
		border: 1px solid var(--border);
		padding: 0.6rem 0.9rem;
		border-radius: var(--radius-sm);
	}
	.select-icon {
		position: absolute;
		right: 1rem;
		top: 50%;
		transform: translateY(-50%);
		pointer-events: none;
		color: var(--text-secondary);
	}

	/* Photo Section in Modal */
	.photo-section {
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1.5rem;
	}
	.photo-header {
		font-weight: 600;
		margin-bottom: 1rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--text-primary);
	}
	.photo-content {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.photo-status.success {
		color: var(--success);
		font-size: 0.9rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.code-pill {
		background: color-mix(in srgb, var(--success) 10%, transparent);
		padding: 0.2rem 0.4rem;
		border-radius: 4px;
		font-family: monospace;
	}

	.file-upload-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.6rem 1.2rem;
		background: var(--border);
		border-radius: var(--radius-sm);
		font-size: 0.9rem;
		cursor: pointer;
		transition: all 0.2s;
		font-weight: 600;
		color: var(--text-primary);
	}
	.file-upload-btn:hover {
		background: rgba(255, 255, 255, 0.1);
		color: var(--accent);
	}
	.file-upload-btn.disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
	.file-upload-btn input {
		display: none;
	}

	.photo-hint {
		font-size: 0.8rem;
		color: var(--text-secondary);
		margin-top: 0.8rem;
		font-style: italic;
	}

	.btn-text {
		background: transparent;
		border: none;
		color: var(--text-secondary);
		font-weight: 600;
		cursor: pointer;
		padding: 0.5rem 1rem;
		transition: color 0.2s;
	}
	.btn-text:hover {
		color: var(--text-primary);
	}

	@media (max-width: 640px) {
		.form-grid {
			grid-template-columns: 1fr;
		}
		.photo-content {
			flex-direction: column;
			align-items: stretch;
		}
		.file-upload-btn {
			justify-content: center;
		}
		.modal-glass {
			max-height: 100vh;
			border-radius: 0;
		}
		.pdf-filters {
			grid-template-columns: 1fr;
		}
	}
</style>
