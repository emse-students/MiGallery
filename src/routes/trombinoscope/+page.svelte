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
		Edit2,
		Trash2,
		Camera,
		CheckCircle,
		UploadCloud,
		Check,
		ChevronDown,
		UserCheck
	} from 'lucide-svelte';
	import Spinner from '$lib/components/Spinner.svelte';
	import BackgroundBlobs from '$lib/components/BackgroundBlobs.svelte';
	import type { User } from '$lib/types/api';
	import { showConfirm } from '$lib/confirm';
	import { toast } from '$lib/toast';
	import { uploadFileChunked } from '$lib/album-operations';
	import jsPDF from 'jspdf';
	import autoTable from 'jspdf-autotable';

	let loading = $state(false);
	let error = $state<string | null>(null);
	let users = $state<User[]>([]);
	let searchQuery = $state<string>('');

	let filteredUsers = $derived.by(() => {
		const q = (searchQuery || '').trim().toLowerCase();
		if (!q) return users;
		return users.filter((u) => {
			const hay = `${u.prenom || ''} ${u.nom || ''} ${u.email || ''} ${u.id_user || ''}`.toLowerCase();
			return hay.includes(q);
		});
	});

	let showEditUserModal = $state(false);
	let editMode = $state<'add' | 'edit'>('add');
	let editUserData = $state({
		id_user: '',
		email: '',
		prenom: '',
		nom: '',
		role: 'user',
		promo_year: null as number | null,
		id_photos: null as string | null
	});
	let selectedUser = $state<User | null>(null);

	let uploadingPhoto = $state(false);
	let uploadPhotoFile = $state<File | null>(null);

	let userRole = $derived((page.data.session?.user as User)?.role || 'user');
	let currentUserId = $derived((page.data.session?.user as User)?.id_user);
	let canAccess = $derived(userRole === 'admin');

	async function exportToPDF() {
		if (filteredUsers.length === 0) {
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
				filteredUsers.map(async (u) => {
					const dataUrl = await loadImage(u.id_user);
					if (dataUrl) images[u.id_user] = dataUrl;
				})
			);

			const usersByPromo: Record<string, User[]> = {};
			filteredUsers.forEach((u) => {
				const p = u.promo_year ? u.promo_year.toString() : 'Staff / Autre';
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
			const imgSize = 25; // Square
			const rowHeight = 45; // Image + text + padding

			promos.forEach((promo) => {
				if (y + 20 > doc.internal.pageSize.getHeight() - margin) {
					doc.addPage();
					y = margin + 10;
				}

				doc.setFontSize(16);
				doc.setTextColor(0);
				doc.setFont('helvetica', 'bold');
				doc.text(`Promo ${promo}`, margin, y);
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
						const name = `${user.prenom || ''}\n${user.nom || ''}`;
						doc.text(name, x + colWidth / 2, y + imgSize + 5, { align: 'center' });
					});

					y += rowHeight;
				}

				y += 5; // Space between promos
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
		const prenom = user.prenom || '';
		const nom = user.nom || '';
		return `${prenom.charAt(0)}${nom.charAt(0)}`.toUpperCase();
	}

	function openAddUserModal() {
		editMode = 'add';
		editUserData = {
			id_user: '',
			email: '',
			prenom: '',
			nom: '',
			role: 'user',
			promo_year: null,
			id_photos: null
		};
		uploadPhotoFile = null;
		showEditUserModal = true;
	}

	function openEditUserModal(user: User, e: MouseEvent) {
		e.stopPropagation();
		editMode = 'edit';
		editUserData = {
			id_user: user.id_user,
			email: user.email || '',
			prenom: user.prenom || '',
			nom: user.nom || '',
			role: user.role || 'user',
			promo_year: user.promo_year || null,
			id_photos: user.id_photos || null
		};
		uploadPhotoFile = null;
		selectedUser = user;
		showEditUserModal = true;
	}

	async function saveUser() {
		if (!editUserData.id_user || !editUserData.email || !editUserData.prenom || !editUserData.nom) {
			toast.error('Les champs ID, email, prénom et nom sont requis.');
			return;
		}

		try {
			let finalIdPhotos = editUserData.id_photos;

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
						const checkResponse = await fetch(`/api/immich/assets/${assetId}?nocache=${Date.now()}`);
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
						console.warn('Erreur polling:', pollError);
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
				editMode === 'add' ? '/api/users' : `/api/users/${encodeURIComponent(editUserData.id_user)}`;

			const res = await fetch(url, {
				method,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ...editUserData, id_photos: finalIdPhotos })
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
		const ok = await showConfirm(`Supprimer ${user.prenom} ${user.nom} ?`, "Supprimer l'utilisateur");
		if (!ok) return;

		try {
			const res = await fetch(`/api/users/${encodeURIComponent(user.id_user)}`, { method: 'DELETE' });
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
		<!-- En-tête -->
		<header class="page-header" in:fade={{ duration: 300, delay: 100 }}>
			<div class="header-content">
				<h1>Trombinoscope</h1>
				<p class="subtitle">L'annuaire des membres de la galerie</p>
			</div>

			<div class="header-search">
				<input
					class="search-input"
					placeholder="Rechercher (prénom, nom, email...)"
					bind:value={searchQuery}
					oninput={(e) => {
						searchQuery = (e.target as HTMLInputElement).value;
					}}
					aria-label="Rechercher des membres"
				/>
			</div>

			<div class="header-actions">
				<button class="action-pill" onclick={exportToPDF} title="Exporter en PDF">
					<Download size={18} />
					<span>PDF</span>
				</button>
				{#if canAccess}
					<button class="action-pill primary" onclick={openAddUserModal}>
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
			<div class="empty-state" in:fade>
				<div class="empty-icon"><Users size={48} /></div>
				<p>Aucun utilisateur trouvé</p>
			</div>
		{/if}

		{#if users.length > 0}
			{#if filteredUsers.length === 0}
				<div class="empty-state" in:fade>
					<div class="empty-icon"><Search size={48} /></div>
					<p>Aucun membre ne correspond à votre recherche</p>
				</div>
			{:else}
				{@const usersByPromo = filteredUsers.reduce((acc, user) => {
					const promo = user.promo_year ? `${user.promo_year}` : 'Staff / Autre';
					if (!acc[promo]) acc[promo] = [];
					acc[promo].push(user);
					return acc;
				}, {} as Record<string, User[]>)}

				<div class="content-area">
					{#each Object.entries(usersByPromo).sort(([a], [b]) => {
						if (a === 'Staff / Autre') return 1;
						if (b === 'Staff / Autre') return -1;
						return Number(b) - Number(a);
					}) as [promo, promoUsers], i}
						<section class="promo-section" in:fade={{ delay: i * 100, duration: 400 }}>
							<div class="section-header">
								<h2>{promo}</h2>
								<span class="count-badge">{promoUsers.length}</span>
							</div>

							<div class="users-grid">
								{#each promoUsers as user (user.id_user)}
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
													onclick={(e) => openEditUserModal(user, e)}
													title="Éditer"
												>
													<Edit2 size={14} />
												</button>
												<button
													class="control-btn delete"
													onclick={(e) => deleteUserConfirm(user, e)}
													title="Supprimer"
												>
													<Trash2 size={14} />
												</button>
											</div>
										{/if}

										<div class="avatar-container">
											{#if user.id_photos}
												<img
													src={`/api/immich/people/${user.id_photos}/thumbnail`}
													alt={`${user.prenom} ${user.nom}`}
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
											<div class="name">{user.prenom} {user.nom}</div>
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
							<label for="email">Email *</label>
							<input
								id="email"
								type="email"
								class="input-glass"
								bind:value={editUserData.email}
								placeholder="@emse.fr"
							/>
						</div>
						<div class="input-group">
							<label for="prenom">Prénom *</label>
							<input id="prenom" class="input-glass" bind:value={editUserData.prenom} />
						</div>
						<div class="input-group">
							<label for="nom">Nom *</label>
							<input id="nom" class="input-glass" bind:value={editUserData.nom} />
						</div>
						<div class="input-group">
							<label for="promo">Promo</label>
							<input
								id="promo"
								type="number"
								class="input-glass"
								bind:value={editUserData.promo_year}
								placeholder="2026"
							/>
						</div>
						<div class="input-group">
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
							{#if editUserData.id_photos}
								<div class="photo-status success">
									<CheckCircle size={16} />
									<span
										>Lié : <code class="code-pill">{editUserData.id_photos.substring(0, 8)}...</code></span
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
										: editUserData.id_photos
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
					<button class="btn-text" onclick={() => (showEditUserModal = false)} disabled={uploadingPhoto}
						>Annuler</button
					>
					<button class="action-pill primary" onclick={saveUser} disabled={uploadingPhoto}>
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
	.trombi-main {
		--tm-bg: var(--bg-primary, #ffffff);
		--tm-card-bg: var(--bg-secondary, rgba(255, 255, 255, 0.7));
		--tm-text: var(--text-primary, #1f2937);
		--tm-text-muted: var(--text-secondary, #6b7280);
		--tm-border: var(--border, #e5e7eb);
		--tm-accent: var(--accent, #3b82f6);
		--tm-glass-border: rgba(255, 255, 255, 0.5);

		position: relative;
		min-height: 100vh;
		padding: 4rem 0 6rem;
		color: var(--tm-text);
		overflow-x: hidden;
		font-family:
			system-ui,
			-apple-system,
			sans-serif;
	}

	:global([data-theme='dark']) .trombi-main {
		--tm-bg: var(--bg-primary, #0f172a);
		--tm-card-bg: var(--bg-secondary, rgba(30, 41, 59, 0.7));
		--tm-text: var(--text-primary, #f3f4f6);
		--tm-text-muted: var(--text-secondary, #94a3b8);
		--tm-border: var(--border, #334155);
		--tm-glass-border: rgba(255, 255, 255, 0.1);
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
		border-radius: 10px;
		border: 1px solid var(--tm-border);
		background: var(--tm-card-bg);
		color: var(--tm-text);
	}
	.search-input:focus {
		outline: none;
		box-shadow: 0 6px 18px rgba(59, 130, 246, 0.08);
		border-color: var(--tm-accent);
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
		color: var(--tm-text-muted);
		font-size: 1.1rem;
		margin: 0;
	}
	.header-actions {
		margin-top: 1.5rem;
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
		background: var(--tm-accent);
		color: white;
	}
	.action-pill.primary:hover {
		transform: translateY(-2px);
		box-shadow: 0 10px 15px -3px rgba(59, 130, 246, 0.4);
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
		color: var(--tm-text-muted);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
		background: var(--tm-card-bg);
		border-radius: 1rem;
		border: 1px solid var(--tm-border);
	}
	.state-message.error {
		color: var(--error);
		border-color: color-mix(in srgb, var(--error) 20%, transparent);
		background: color-mix(in srgb, var(--error) 5%, transparent);
	}
	.empty-state {
		padding: 4rem;
		text-align: center;
		color: var(--tm-text-muted);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
		opacity: 0.8;
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
		border-bottom: 1px solid var(--tm-border);
	}
	.section-header h2 {
		font-size: 1.5rem;
		margin: 0;
		color: var(--tm-text);
		font-weight: 700;
		letter-spacing: -0.01em;
	}
	.count-badge {
		background: var(--tm-accent);
		color: white;
		opacity: 0.2;
		padding: 0.2rem 0.6rem;
		border-radius: 12px;
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
		background: var(--tm-card-bg);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		border: 1px solid var(--tm-glass-border);
		border-radius: 20px;
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
		border-color: var(--tm-accent);
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
		border-radius: 8px;
		border: none;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		backdrop-filter: blur(4px);
		transition: all 0.2s;
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
		border: 4px solid var(--tm-card-bg);
		box-shadow: 0 8px 20px rgba(0, 0, 0, 0.1);
		background: var(--tm-border);
		overflow: hidden;
		transition: border-color 0.3s;
	}
	.user-card:hover .avatar-container {
		border-color: var(--tm-accent);
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
		color: var(--tm-text-muted);
		background: var(--tm-bg);
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
		color: var(--tm-text);
		margin-bottom: 0.1rem;
		line-height: 1.2;
	}
	.username {
		font-family: monospace;
		font-size: 0.85rem;
		color: var(--tm-text-muted);
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
		background: rgba(236, 72, 153, 0.15);
		color: #ec4899;
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
		background: var(--tm-card-bg);
		width: 90%;
		max-width: 520px;
		padding: 1.75rem;
		border-radius: 18px;
		border: 1px solid var(--tm-glass-border);
		box-shadow: 0 20px 50px rgba(2, 6, 23, 0.6);
		text-align: center;
		position: relative;
		overflow: hidden;
		backdrop-filter: blur(8px) saturate(120%);
		max-height: 90vh;
		display: flex;
		flex-direction: column;
	}
	.modal-header {
		padding: 1.5rem;
		border-bottom: 1px solid var(--tm-border);
		background: rgba(255, 255, 255, 0.02);
		flex-shrink: 0;
	}
	.modal-header h3 {
		margin: 0;
		font-size: 1.2rem;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		color: var(--tm-text);
	}

	.modal-body {
		padding: 2rem;
		overflow-y: auto;
		flex: 1;
	}
	.modal-actions {
		padding: 1.5rem;
		border-top: 1px solid var(--tm-border);
		background: rgba(255, 255, 255, 0.02);
		display: flex;
		justify-content: flex-end;
		gap: 1rem;
		flex-shrink: 0;
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
		color: var(--tm-text-muted);
		margin-left: 2px;
	}

	.input-glass {
		padding: 0.75rem 1rem;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid var(--tm-border);
		border-radius: 12px;
		font-size: 0.95rem;
		color: var(--tm-text);
		width: 100%;
		transition: all 0.2s;
	}
	.input-glass:focus {
		outline: none;
		border-color: var(--tm-accent);
		background: rgba(255, 255, 255, 0.05);
		box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
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
		color: var(--tm-text);
		border: 1px solid var(--tm-border);
		padding: 0.6rem 0.9rem;
		border-radius: 10px;
	}
	.select-icon {
		position: absolute;
		right: 1rem;
		top: 50%;
		transform: translateY(-50%);
		pointer-events: none;
		color: var(--tm-text-muted);
	}

	/* Photo Section in Modal */
	.photo-section {
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid var(--tm-border);
		border-radius: 16px;
		padding: 1.5rem;
	}
	.photo-header {
		font-weight: 600;
		margin-bottom: 1rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--tm-text);
	}
	.photo-content {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.photo-status.success {
		color: #10b981;
		font-size: 0.9rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.code-pill {
		background: rgba(16, 185, 129, 0.1);
		padding: 0.2rem 0.4rem;
		border-radius: 4px;
		font-family: monospace;
	}

	.file-upload-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.6rem 1.2rem;
		background: var(--tm-border);
		border-radius: 10px;
		font-size: 0.9rem;
		cursor: pointer;
		transition: all 0.2s;
		font-weight: 600;
		color: var(--tm-text);
	}
	.file-upload-btn:hover {
		background: rgba(255, 255, 255, 0.1);
		color: var(--tm-accent);
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
		color: var(--tm-text-muted);
		margin-top: 0.8rem;
		font-style: italic;
	}

	.btn-text {
		background: transparent;
		border: none;
		color: var(--tm-text-muted);
		font-weight: 600;
		cursor: pointer;
		padding: 0.5rem 1rem;
		transition: color 0.2s;
	}
	.btn-text:hover {
		color: var(--tm-text);
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
	}
</style>
