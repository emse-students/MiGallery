<script lang="ts">
	import {
		Users,
		Search,
		Trash2,
		Camera,
		Download,
		Funnel,
		GraduationCap,
		BookOpen,
		CheckCircle,
		CloudUpload,
		Check
	} from 'lucide-svelte';
	import { fade, fly } from 'svelte/transition';
	import { invalidateAll } from '$app/navigation';
	import Avatar from '$lib/components/Avatar.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import Spinner from '$lib/components/Spinner.svelte';
	import { fuzzyMatch } from '$lib/fuzzy';
	import { toast } from '$lib/toast';
	import { uploadFileChunked } from '$lib/album-operations';
	import jsPDF from 'jspdf';
	import { m } from '$lib/paraglide/messages';
	import type { PageData } from './$types';
	import type { UserRow } from '$lib/types/api';

	let { data } = $props<{ data: PageData }>();

	const users = $derived(data.users as UserRow[]);
	const currentUserId = $derived(data.currentUserId as string);

	const ROLE_LABELS: Record<string, string> = {
		user: m.usr_role_user(),
		mitviste: m.usr_role_mitviste(),
		admin: m.usr_role_admin()
	};
	const ROLES = ['user', 'mitviste', 'admin'];

	// Opaque internal keys for the "no promo" / "no program" buckets. Kept separate
	// from their localized labels so grouping/sorting stay language-independent.
	const STAFF_KEY = '__staff_other__';
	const NO_FORMATION_KEY = '__no_formation__';

	function promoLabel(key: string): string {
		return key === STAFF_KEY ? m.trombi_staff_other() : m.trombi_promo({ promo: key });
	}
	function promoKey(u: UserRow): string {
		return u.promo ? u.promo.toString() : STAFF_KEY;
	}
	function formationKey(u: UserRow): string {
		return u.formation || NO_FORMATION_KEY;
	}

	function sortByLastName(arr: UserRow[]): UserRow[] {
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

	let searchQuery = $state('');
	let savingId = $state<string | null>(null);

	let showDelete = $state(false);
	let deleteTarget = $state<UserRow | null>(null);

	const filtered = $derived(
		users.filter((u) => {
			const haystack = [
				u.name,
				u.first_name,
				u.last_name,
				u.formation,
				u.promo != null ? String(u.promo) : '',
				ROLE_LABELS[u.role || 'user']
			]
				.filter(Boolean)
				.join(' ');
			return fuzzyMatch(searchQuery, haystack);
		})
	);

	// --- PDF export ---
	let showPdfModal = $state(false);
	let pdfSelectedPromos = $state<string[]>([]);
	let pdfSelectedFormations = $state<string[]>([]);

	let availablePromos = $derived(
		[...new Set(users.map(promoKey))].sort((a, b) => {
			if (a === STAFF_KEY) return 1;
			if (b === STAFF_KEY) return -1;
			return Number(b) - Number(a);
		})
	);

	let availableFormations = $derived(
		[...new Set(users.map(formationKey))].sort((a, b) => {
			if (a === NO_FORMATION_KEY) return 1;
			if (b === NO_FORMATION_KEY) return -1;
			return a.localeCompare(b, 'fr');
		})
	);

	let pdfSelectedCount = $derived.by(() => {
		const promoSet = new Set(pdfSelectedPromos);
		const formationSet = new Set(pdfSelectedFormations);
		return users.filter((u) => promoSet.has(promoKey(u)) && formationSet.has(formationKey(u))).length;
	});

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

	async function exportToPDF(usersToExport: UserRow[]) {
		showPdfModal = false;
		if (usersToExport.length === 0) {
			toast.info(m.trombi_no_users_export());
			return;
		}

		const toastId = toast.loading(m.trombi_pdf_generating());
		try {
			const doc = new jsPDF();

			doc.setFontSize(18);
			doc.text(m.trombi_pdf_title(), 14, 22);
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

			const usersByPromo: Record<string, UserRow[]> = {};
			usersToExport.forEach((u) => {
				const p = promoKey(u);
				if (!usersByPromo[p]) usersByPromo[p] = [];
				usersByPromo[p].push(u);
			});

			const promos = Object.keys(usersByPromo).sort((a, b) => {
				if (a === STAFF_KEY) return 1;
				if (b === STAFF_KEY) return -1;
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
				doc.text(promoLabel(promo), margin, y);
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
						const name = user.name || `${user.first_name || ''} ${user.last_name || ''}`.trim();
						doc.text(name, x + colWidth / 2, y + imgSize + 5, { align: 'center' });
					});

					y += rowHeight;
				}

				y += 5;
			});

			doc.save('trombinoscope.pdf');
			toast.dismiss(toastId);
			toast.success(m.trombi_pdf_downloaded());
		} catch (e) {
			console.error(e);
			toast.dismiss(toastId);
			toast.error(m.trombi_pdf_error());
		}
	}

	// --- Profile photo editing ---
	let showPhotoModal = $state(false);
	let photoTarget = $state<UserRow | null>(null);
	let uploadPhotoFile = $state<File | null>(null);
	let uploadingPhoto = $state(false);

	function openPhotoModal(user: UserRow) {
		photoTarget = user;
		uploadPhotoFile = null;
		showPhotoModal = true;
	}

	async function savePhoto() {
		const target = photoTarget;
		if (!target) return;

		try {
			let finalIdPhotos = target.photos_id;

			if (uploadPhotoFile) {
				uploadingPhoto = true;

				const uploadRes = await uploadFileChunked(uploadPhotoFile);
				if (!uploadRes.ok) throw new Error(m.trombi_photo_upload_error());

				const uploadData = (await uploadRes.json()) as { id: string };
				const assetId = uploadData.id;
				if (!assetId) throw new Error(m.trombi_photo_upload_error());

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
						console.warn('Polling error:', pollError);
					}
				}

				if (people.length === 0) {
					uploadingPhoto = false;
					toast.error(m.trombi_no_face());
					return;
				}
				if (people.length > 1) {
					uploadingPhoto = false;
					toast.error(m.trombi_multiple_faces({ count: people.length }));
					return;
				}
				finalIdPhotos = people[0].id;
				uploadingPhoto = false;
			}

			// Round-trip the existing SSO-managed fields; only photos_id changes.
			const res = await fetch(`/api/users/${encodeURIComponent(target.id_user)}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: target.name,
					first_name: target.first_name,
					last_name: target.last_name,
					role: target.role,
					promo: target.promo,
					photos_id: finalIdPhotos,
					formation: target.formation
				})
			});

			if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));

			await invalidateAll();
			showPhotoModal = false;
			photoTarget = null;
			uploadPhotoFile = null;
			toast.success(m.trombi_user_updated());
		} catch (e: unknown) {
			uploadingPhoto = false;
			toast.error(m.common_error_detail({ error: (e as Error).message }));
		}
	}

	async function changeRole(user: UserRow, newRole: string) {
		if (newRole === user.role) return;
		savingId = user.id_user;
		try {
			const res = await fetch(`/api/users/${encodeURIComponent(user.id_user)}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: user.name,
					first_name: user.first_name,
					last_name: user.last_name,
					role: newRole,
					promo: user.promo,
					photos_id: user.photos_id,
					formation: user.formation
				})
			});
			if (!res.ok) {
				const err = (await res.json().catch(() => ({}))) as { error?: string };
				throw new Error(err.error || `HTTP ${res.status}`);
			}
			toast.success(m.usr_role_updated({ name: user.name }));
			await invalidateAll();
		} catch (e) {
			toast.error(m.common_fail_detail({ error: (e as Error).message }));
		} finally {
			savingId = null;
		}
	}

	function askDelete(user: UserRow) {
		deleteTarget = user;
		showDelete = true;
	}

	async function confirmDelete() {
		const user = deleteTarget;
		if (!user) return;
		savingId = user.id_user;
		try {
			const res = await fetch(`/api/users/${encodeURIComponent(user.id_user)}`, { method: 'DELETE' });
			if (!res.ok) {
				const err = (await res.json().catch(() => ({}))) as { error?: string };
				throw new Error(err.error || `HTTP ${res.status}`);
			}
			toast.success(m.usr_deleted({ name: user.name }));
			await invalidateAll();
		} catch (e) {
			toast.error(m.common_fail_detail({ error: (e as Error).message }));
		} finally {
			savingId = null;
			deleteTarget = null;
		}
	}
</script>

<svelte:head>
	<title>{m.usr_page_title()}</title>
</svelte:head>

<div class="admin-wrapper">
	<header class="view-header">
		<div class="icon-box"><Users size={26} /></div>
		<div class="title-box">
			<h1>{m.usr_title()}</h1>
			<p class="count-subtitle">{m.usr_count({ count: users.length })}</p>
		</div>
		<button type="button" class="btn-glass export-pdf-btn" onclick={openPdfModal} title={m.trombi_export_pdf()}>
			<Download size={18} />
			<span>PDF</span>
		</button>
	</header>

	<div class="search-bar">
		<Search size={16} />
		<input type="search" placeholder={m.usr_search_ph()} bind:value={searchQuery} />
	</div>

	<div class="data-table-container">
		<div class="data-list">
			{#each filtered as user (user.id_user)}
				{@const isSelf = user.id_user === currentUserId}
				<div class="data-row">
					<div class="row-identity">
						<Avatar
							userId={user.id_user}
							firstName={user.first_name}
							lastName={user.last_name}
							name={user.name}
							size={44}
						/>
						<div class="identity-text">
							<div class="identity-name-line">
								<span class="txt-name">{user.name}</span>
								{#if isSelf}<span class="badge self-tag">{m.usr_you()}</span>{/if}
							</div>
							<div class="identity-meta-line">
								{#if user.promo}<span class="badge promo-tag">{user.promo}</span>{/if}
								{#if user.formation}<span class="txt-formation">{user.formation}</span>{/if}
							</div>
						</div>
					</div>

					<div class="row-actions">
						<button
							type="button"
							class="action-btn-photo"
							disabled={savingId === user.id_user}
							title={m.trombi_photo_link()}
							onclick={() => openPhotoModal(user)}
						>
							<Camera size={16} />
						</button>

						<div class="select-wrapper">
							<select
								class="action-select role-{user.role || 'user'}"
								value={user.role || 'user'}
								disabled={savingId === user.id_user || isSelf}
								title={isSelf ? m.usr_no_self_role() : m.usr_change_role()}
								onchange={(e) => changeRole(user, e.currentTarget.value)}
							>
								{#each ROLES as r}
									<option value={r}>{ROLE_LABELS[r]}</option>
								{/each}
							</select>
						</div>

						<button
							type="button"
							class="action-btn-delete"
							disabled={savingId === user.id_user || isSelf}
							title={isSelf ? m.usr_no_self_delete() : m.common_delete()}
							onclick={() => askDelete(user)}
						>
							<Trash2 size={16} />
						</button>
					</div>
				</div>
			{:else}
				<div class="empty-wrap">
					<EmptyState
						icon={Search}
						title={m.usr_no_results()}
						description={m.usr_no_results_desc()}
						size="sm"
					/>
				</div>
			{/each}
		</div>
	</div>
</div>

<Modal
	bind:show={showDelete}
	type="confirm"
	title={m.usr_delete_title()}
	confirmText={m.common_delete()}
	onConfirm={confirmDelete}
	onCancel={() => (deleteTarget = null)}
>
	<p>
		{m.usr_delete_body_before()}<strong>{deleteTarget?.name}</strong>{m.usr_delete_body_after()}
	</p>
</Modal>

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
				<h3><Funnel size={20} /> {m.trombi_export_pdf()}</h3>
			</div>

			<div class="modal-body">
				<div class="pdf-filters">
					<div class="pdf-filter-col">
						<div class="pdf-filter-heading">
							<GraduationCap size={15} />
							<span>{m.trombi_promotions()}</span>
							<div class="quick-btns">
								<button type="button" onclick={() => (pdfSelectedPromos = [...availablePromos])}
									>{m.trombi_all()}</button
								>
								<button type="button" onclick={() => (pdfSelectedPromos = [])}>{m.trombi_none()}</button>
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
									<span>{promoLabel(promo)}</span>
								</label>
							{/each}
						</div>
					</div>

					<div class="pdf-filter-col">
						<div class="pdf-filter-heading">
							<BookOpen size={15} />
							<span>{m.trombi_formations()}</span>
							<div class="quick-btns">
								<button type="button" onclick={() => (pdfSelectedFormations = [...availableFormations])}
									>{m.trombi_all()}</button
								>
								<button type="button" onclick={() => (pdfSelectedFormations = [])}>{m.trombi_none()}</button
								>
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
									<span>{formation === NO_FORMATION_KEY ? m.trombi_no_formation() : formation}</span>
								</label>
							{/each}
						</div>
					</div>
				</div>

				<p class="export-count">
					{m.trombi_export_count({ count: pdfSelectedCount })}
				</p>
			</div>

			<div class="modal-actions">
				<button class="btn-text" type="button" onclick={() => (showPdfModal = false)}
					>{m.common_cancel()}</button
				>
				<button
					class="action-pill primary"
					type="button"
					onclick={startPdfExport}
					disabled={pdfSelectedCount === 0}
				>
					<Download size={16} />
					{m.trombi_export()}
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Profile Photo Modal -->
{#if showPhotoModal && photoTarget}
	<div
		class="modal-backdrop"
		onclick={() => !uploadingPhoto && (showPhotoModal = false)}
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
				<h3><Camera size={22} /> {photoTarget.name}</h3>
			</div>

			<div class="modal-body">
				<div class="photo-section">
					<div class="photo-header">
						<Camera size={18} />
						{m.trombi_photo_link()}
					</div>
					<div class="photo-content">
						{#if photoTarget.photos_id}
							<div class="photo-status success">
								<CheckCircle size={16} />
								<span
									>{m.trombi_photo_linked_label()}
									<code class="code-pill">{photoTarget.photos_id.substring(0, 8)}...</code></span
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
								<Spinner size={16} /> {m.trombi_analyzing()}
							{:else}
								<CloudUpload size={16} />
								{uploadPhotoFile
									? uploadPhotoFile.name
									: photoTarget.photos_id
										? m.trombi_replace_photo()
										: m.trombi_upload_photo()}
							{/if}
						</label>
					</div>
					<p class="photo-hint">
						{m.trombi_photo_hint()}
					</p>
				</div>
			</div>

			<div class="modal-actions">
				<button
					class="btn-text"
					type="button"
					onclick={() => (showPhotoModal = false)}
					disabled={uploadingPhoto}>{m.common_cancel()}</button
				>
				<button
					class="action-pill primary"
					type="button"
					onclick={savePhoto}
					disabled={uploadingPhoto || !uploadPhotoFile}
				>
					{#if uploadingPhoto}
						<Spinner size={16} />
					{:else}
						<Check size={16} />
					{/if}
					{m.common_save()}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	/* Structure principale */
	.admin-wrapper {
		width: 100%;
		max-width: 900px;
		margin: 0 auto;
		padding: 1.5rem 1rem;
	}

	@media (min-width: 640px) {
		.admin-wrapper {
			padding: 2.5rem 1.5rem;
		}
	}

	/* Header */
	.view-header {
		display: flex;
		align-items: center;
		gap: 1.25rem;
		margin-bottom: 2rem;
	}

	.icon-box {
		width: 52px;
		height: 52px;
		flex-shrink: 0;
		background: var(--gradient-brand);
		color: #fff;
		border-radius: var(--radius-md);
		display: flex;
		align-items: center;
		justify-content: center;
		box-shadow: 0 8px 16px color-mix(in srgb, var(--accent) 25%, transparent);
	}

	.title-box h1 {
		font-size: clamp(1.4rem, 4vw, 1.8rem);
		font-weight: 700;
		margin: 0;
		letter-spacing: -0.02em;
	}

	.count-subtitle {
		color: var(--text-secondary);
		font-size: 0.95rem;
		margin: 0.25rem 0 0;
	}

	/* Positioning only; visual style comes from .btn-glass. */
	.export-pdf-btn {
		margin-left: auto;
	}

	/* Search bar */
	.search-bar {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		background: var(--bg-secondary);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		padding: 0 1.25rem;
		color: var(--text-muted);
		margin-bottom: 1.5rem;
		transition: all 0.2s ease;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.02);
	}

	.search-bar:focus-within {
		border-color: var(--accent);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 15%, transparent);
	}

	.search-bar input {
		flex: 1;
		border: none;
		background: transparent;
		color: var(--text-primary);
		padding: 0.85rem 0;
		font-size: 0.95rem;
		outline: none;
	}

	/* Table container (unified look) */
	.data-table-container {
		background: var(--bg-secondary);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		overflow: hidden; /* Clips the row borders at the edges */
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.05);
	}

	.data-list {
		display: flex;
		flex-direction: column;
	}

	/* Individual row */
	.data-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 1rem 1.25rem;
		background: transparent;
		border-bottom: 1px solid var(--border);
		transition: background-color 0.15s ease;
	}

	.data-row:last-child {
		border-bottom: none;
	}

	.data-row:hover {
		background: var(--bg-tertiary);
	}

	/* Left section (Info) */
	.row-identity {
		display: flex;
		align-items: center;
		gap: 1.25rem;
		flex: 1;
		min-width: 0; /* Vital for text truncation */
	}

	/* FORCE left alignment to break the old global behavior */
	.identity-text {
		display: flex;
		flex-direction: column;
		align-items: flex-start !important;
		justify-content: center;
		gap: 0.25rem;
		text-align: left !important;
		background: transparent !important;
		border: none !important;
		padding: 0 !important;
		margin: 0 !important;
		min-width: 0;
	}

	.identity-name-line {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		max-width: 100%;
	}

	.txt-name {
		font-weight: 600;
		font-size: 1rem;
		color: var(--text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.identity-meta-line {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.txt-formation {
		font-size: 0.85rem;
		color: var(--text-secondary);
		white-space: nowrap;
	}

	/* Badges */
	.badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.15rem 0.5rem;
		border-radius: var(--radius-xs);
		font-weight: 600;
		font-size: 0.75rem;
		line-height: 1.2;
	}

	.promo-tag {
		background: color-mix(in srgb, var(--accent) 15%, transparent);
		color: var(--accent);
	}

	.self-tag {
		border: 1px solid var(--border);
		color: var(--text-muted);
		text-transform: uppercase;
		font-size: 0.65rem;
		letter-spacing: 0.05em;
	}

	/* Right section (Actions) */
	.row-actions {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	/* Custom select */
	.select-wrapper {
		position: relative;
	}

	/* Custom arrow integrated into the select */
	.select-wrapper::after {
		content: '';
		position: absolute;
		right: 0.8rem;
		top: 50%;
		transform: translateY(-50%);
		width: 14px;
		height: 14px;
		/* currentColor does NOT resolve inside a data-URI background image, so the
		   chevron rendered black (invisible in dark). Drive the colour via
		   background-color + an alpha mask so it follows the theme token. */
		background-color: var(--text-muted);
		-webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")
			center / contain no-repeat;
		mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")
			center / contain no-repeat;
		pointer-events: none;
		opacity: 0.7;
	}

	.action-select {
		appearance: none;
		-webkit-appearance: none;
		min-width: 130px;
		background: var(--bg-primary);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		color: var(--text-primary);
		padding: 0.45rem 2.2rem 0.45rem 0.8rem;
		font-size: 0.85rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.action-select:hover:not(:disabled) {
		border-color: var(--text-muted);
	}

	.action-select:focus {
		outline: 2px solid var(--accent);
		outline-offset: -1px;
		border-color: transparent;
	}

	.action-select:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* Role colors in the select! */
	.action-select.role-admin {
		color: var(--error, #ef4444);
		background-color: color-mix(in srgb, var(--error, #ef4444) 6%, var(--bg-primary));
		border-color: color-mix(in srgb, var(--error, #ef4444) 20%, var(--border));
	}

	.action-select.role-mitviste {
		color: var(--edit, #f59e0b);
		background-color: color-mix(in srgb, var(--edit, #f59e0b) 6%, var(--bg-primary));
		border-color: color-mix(in srgb, var(--edit, #f59e0b) 20%, var(--border));
	}

	/* Photo + delete buttons */
	.action-btn-photo,
	.action-btn-delete {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		padding: 0;
		background: transparent;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		color: var(--text-muted);
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.action-btn-photo:hover:not(:disabled) {
		border-color: var(--accent);
		color: var(--accent);
		background: color-mix(in srgb, var(--accent) 10%, transparent);
	}

	.action-btn-delete:hover:not(:disabled) {
		border-color: var(--error);
		color: var(--error);
		background: color-mix(in srgb, var(--error) 10%, transparent);
	}

	.action-btn-photo:disabled,
	.action-btn-delete:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.empty-wrap {
		padding: 3rem 1rem;
	}

	/* --- Modals (PDF + photo) --- */
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
		border-radius: 18px;
		border: 1px solid var(--glass-border);
		box-shadow: 0 20px 50px rgba(2, 6, 23, 0.6);
		text-align: left;
		position: relative;
		overflow: hidden;
		backdrop-filter: blur(8px) saturate(120%);
		max-height: 90vh;
		display: flex;
		flex-direction: column;
	}
	.modal-glass.pdf-modal {
		max-width: 560px;
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
	}
	.action-pill.primary {
		background: var(--accent);
		color: white;
	}
	.action-pill.primary:hover:not(:disabled) {
		transform: translateY(-2px);
		box-shadow: 0 10px 15px -3px color-mix(in srgb, var(--accent) 40%, transparent);
	}
	.action-pill:disabled {
		opacity: 0.7;
		cursor: not-allowed;
		transform: none;
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

	/* Adaptation Mobile */
	@media (max-width: 640px) {
		.pdf-filters {
			grid-template-columns: 1fr;
		}
		.photo-content {
			flex-direction: column;
			align-items: stretch;
		}
		.file-upload-btn {
			justify-content: center;
		}
	}

	@media (max-width: 540px) {
		.data-row {
			flex-direction: column;
			align-items: stretch;
			gap: 1.25rem;
			padding: 1.25rem;
		}

		.row-actions {
			justify-content: flex-end;
		}

		.select-wrapper {
			flex: 1;
		}

		.action-select {
			width: 100%; /* Le select prend toute la place sur mobile */
		}
	}
</style>
