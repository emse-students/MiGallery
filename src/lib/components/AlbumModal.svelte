<script lang="ts">
	import { onMount } from 'svelte';
	import { AlertCircle, Search, X, Plus } from 'lucide-svelte';
	import Spinner from './Spinner.svelte';
	import Modal from './Modal.svelte';

	interface Props {
		albumId?: string;
		onClose: () => void;
		onSuccess?: (albumId?: string) => void;
	}

	type UserOption = {
		id_user: string;
		name: string;
		first_name?: string | null;
		last_name?: string | null;
		formation?: string | null;
		promo?: number | null;
	};

	let { albumId, onClose, onSuccess }: Props = $props();

	const isEditMode = $derived(!!albumId);
	const safeAlbumId = $derived(albumId ? String(albumId) : '');

	let show = $state(true);
	let albumName = $state('');
	let albumDate = $state(getDefaultDate());
	let albumLocation = $state('');
	let albumVisibility = $state<'private' | 'authenticated' | 'unlisted'>('private');
	let albumVisible = $state(true);

	let availableUsers = $state<UserOption[]>([]);
	let availableFormations = $state<string[]>([]);

	let selectedUserIds = $state<string[]>([]);
	let selectedFormations = $state<string[]>([]);
	let selectedPromos = $state<number[]>([]);
	let promosManuallyEdited = $state(false);
	let formationsManuallyEdited = $state(false);

	const CURRENT_SCHOOL_YEAR = getCurrentSchoolYear();
	const promoYears: number[] = Array.from(
		{ length: CURRENT_SCHOOL_YEAR - 1816 + 1 },
		(_, i) => CURRENT_SCHOOL_YEAR - i
	);
	let promoSelectorYear = $state(CURRENT_SCHOOL_YEAR);

	let userSearch = $state('');
	let showUserSuggestions = $state(false);

	let loading = $state(false);
	let loadingData = $state(false);
	let loadingOptions = $state(false);
	let error = $state<string | null>(null);

	function getDefaultDate() {
		const today = new Date();
		const year = today.getFullYear();
		const month = String(today.getMonth() + 1).padStart(2, '0');
		const day = String(today.getDate()).padStart(2, '0');
		return `${year}-${month}-${day}`;
	}

	function getCurrentSchoolYear(referenceDate: Date = new Date()): number {
		const year = referenceDate.getFullYear();
		const month = referenceDate.getMonth() + 1;
		return month >= 9 ? year + 1 : year;
	}

	function getDefaultPromosFromDate(dateValue: string): number[] {
		const parsed = new Date(`${dateValue}T00:00:00`);
		const baseDate = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
		const currentSchoolYear = getCurrentSchoolYear(baseDate);
		return [
			currentSchoolYear - 3,
			currentSchoolYear - 2,
			currentSchoolYear - 1,
			currentSchoolYear
		];
	}

	function applyDefaultPromosFromDate() {
		if (isEditMode || promosManuallyEdited) return;
		selectedPromos = [...getDefaultPromosFromDate(albumDate)];
	}

	function extractPromoYearsFromLegacyTags(tags: string[]): number[] {
		const out = new Set<number>();
		for (const rawTag of tags) {
			const match = String(rawTag).trim().match(/^promo\s+(\d{4})$/i);
			if (match) {
				out.add(Number.parseInt(match[1], 10));
			}
		}
		return [...out].sort((a, b) => a - b);
	}

	function userLabel(user: UserOption): string {
		const fullName = user.name?.trim();
		if (fullName) return fullName;
		return [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || user.id_user;
	}

	const selectedUsers = $derived(
		selectedUserIds
			.map((id) => availableUsers.find((u) => u.id_user === id))
			.filter((u): u is UserOption => !!u)
	);

	const userSuggestions = $derived.by(() => {
		const q = userSearch.trim().toLowerCase();
		if (!q) return [];
		return availableUsers
			.filter((u) => !selectedUserIds.includes(u.id_user))
			.filter((u) => {
				const hay = `${u.id_user} ${u.name || ''} ${u.first_name || ''} ${u.last_name || ''}`.toLowerCase();
				return hay.includes(q);
			})
			.slice(0, 8);
	});

	function addFormation(formation: string) {
		formationsManuallyEdited = true;
		if (!selectedFormations.includes(formation)) {
			selectedFormations = [...selectedFormations, formation];
		}
	}

	function removeFormation(formation: string) {
		formationsManuallyEdited = true;
		selectedFormations = selectedFormations.filter((f) => f !== formation);
	}

	function addPromo(promo: number) {
		promosManuallyEdited = true;
		if (!selectedPromos.includes(promo)) {
			selectedPromos = [...selectedPromos, promo].sort((a, b) => a - b);
		}
	}

	function removePromo(promo: number) {
		promosManuallyEdited = true;
		selectedPromos = selectedPromos.filter((p) => p !== promo);
	}

	function addPromoFromSelector() {
		addPromo(promoSelectorYear);
	}

	function addUser(user: UserOption) {
		if (!selectedUserIds.includes(user.id_user)) {
			selectedUserIds = [...selectedUserIds, user.id_user];
		}
		userSearch = '';
		showUserSuggestions = false;
	}

	function removeUser(userId: string) {
		selectedUserIds = selectedUserIds.filter((id) => id !== userId);
	}

	async function loadSharingOptions() {
		loadingOptions = true;
		try {
			const res = await fetch('/api/albums/permissions/options');
			if (!res.ok) {
				const err = await res.text().catch(() => res.statusText);
				throw new Error(err || 'Erreur chargement options de partage');
			}

			const data = (await res.json()) as {
				success?: boolean;
				users?: UserOption[];
				formations?: string[];
				promos?: number[];
			};
			availableUsers = data.users || [];
			availableFormations = data.formations || [];

			if (!isEditMode) {
				if (!formationsManuallyEdited && selectedFormations.length === 0) {
					selectedFormations = ['ICM'];
				}

				if (!promosManuallyEdited && selectedPromos.length === 0) {
					applyDefaultPromosFromDate();
				}
			}
		} catch (e: unknown) {
			error = (e as Error).message;
		} finally {
			loadingOptions = false;
		}
	}

	async function loadAlbumData() {
		if (!safeAlbumId) return;
		loadingData = true;
		error = null;

		try {
			const res = await fetch(`/api/albums/${safeAlbumId}/info`);

			if (!res.ok) {
				const errorData = (await res.json().catch(() => ({}))) as { error?: string };
				throw new Error(errorData.error || "Erreur lors du chargement de l'album");
			}

			const result = (await res.json()) as {
				success?: boolean;
				album?: {
					id: string;
					name: string;
					date?: string;
					location?: string;
					visibility?: string;
					visible?: number;
				};
				tags?: string[];
				users?: string[];
				formations?: string[];
				promos?: number[];
			};

			if (!result.success || !result.album) {
				throw new Error('Album non trouvé');
			}

			const album = result.album;
			albumName = album.name || '';
			albumDate = album.date || '';
			albumLocation = album.location || '';
			albumVisibility = (album.visibility as 'private' | 'authenticated' | 'unlisted') || 'private';
			albumVisible = album.visible === 1;
			selectedUserIds = result.users || [];
			selectedFormations = result.formations || [];
			selectedPromos = result.promos || extractPromoYearsFromLegacyTags(result.tags || []);
		} catch (e: unknown) {
			error = (e as Error).message;
		} finally {
			loadingData = false;
		}
	}

	async function handleSubmit() {
		if (!albumName.trim()) {
			error = "Le nom de l'album est requis";
			return;
		}

		loading = true;
		error = null;

		const payload = {
			date: albumDate || null,
			location: albumLocation.trim() || null,
			visibility: albumVisibility,
			visible: albumVisible,
			formations: selectedFormations,
			promos: selectedPromos,
			allowedUsers: selectedUserIds
		};

		try {
			if (isEditMode) {
				const res = await fetch(`/api/albums/${safeAlbumId}`, {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						name: albumName.trim(),
						...payload
					})
				});

				if (!res.ok) {
					const errData = (await res.json().catch(() => ({}))) as { error?: string };
					throw new Error(errData.error || "Erreur lors de la mise à jour de l'album");
				}
			} else {
				const res = await fetch('/api/albums', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						albumName: albumName.trim(),
						...payload
					})
				});

				if (!res.ok) {
					const errText = await res.text().catch(() => res.statusText);
					throw new Error(errText || "Erreur lors de la création de l'album");
				}

				const createdAlbum = (await res.json()) as { id?: string };
				if (onSuccess) await onSuccess(createdAlbum.id);
				onClose();
				return;
			}

			if (onSuccess) await onSuccess();
			onClose();
		} catch (e: unknown) {
			error = (e as Error).message;
		} finally {
			loading = false;
		}
	}

	onMount(async () => {
		await loadSharingOptions();
		if (isEditMode) {
			await loadAlbumData();
		}
	});
</script>

<Modal
	bind:show
	title={isEditMode ? "Modifier l'album" : 'Créer un nouvel album'}
	icon={isEditMode ? 'edit' : 'folder-plus'}
	confirmText={isEditMode ? 'Enregistrer' : "Créer l'album"}
	confirmDisabled={loading || loadingData || loadingOptions}
	showCloseButton={true}
	onConfirm={handleSubmit}
	onCancel={onClose}
>
	{#if error}
		<div class="error-message">
			<AlertCircle size={20} />
			<p>{error}</p>
		</div>
	{/if}

	{#if loadingData || loadingOptions}
		<div class="loading-state">
			<Spinner size={40} />
			<p>Chargement des données...</p>
		</div>
	{:else}
		<form
			onsubmit={(e) => {
				e.preventDefault();
				handleSubmit();
			}}
		>
			<div class="form-group">
				<label for="albumName">Nom de l'album *</label>
				<input
					id="albumName"
					type="text"
					bind:value={albumName}
					placeholder="Ex: Soirée Gala 2025"
					required
					disabled={loading}
				/>
			</div>

			<div class="meta-grid">
				<div class="form-group">
					<label for="albumDate">Date (optionnel)</label>
					<input
						id="albumDate"
						type="date"
						bind:value={albumDate}
						onchange={applyDefaultPromosFromDate}
						disabled={loading}
					/>
				</div>

				<div class="form-group">
					<label for="albumLocation">Lieu (optionnel)</label>
					<input
						id="albumLocation"
						type="text"
						bind:value={albumLocation}
						placeholder="Ex: Campus Mines Saint-Etienne"
						disabled={loading}
					/>
				</div>
			</div>

			<div class="form-group">
				<label for="albumVisibility">Visibilité</label>
				<select id="albumVisibility" bind:value={albumVisibility} disabled={loading}>
					<option value="private">Privé</option>
					<option value="authenticated">Authentifié (tous les utilisateurs connectés)</option>
					<option value="unlisted">Accès par lien</option>
				</select>
			</div>

			<div class="form-group-checkbox">
				<label>
					<input type="checkbox" bind:checked={albumVisible} disabled={loading} />
					<span>Visible dans la liste des albums</span>
				</label>
			</div>

			{#if albumVisibility === 'private'}
				<div class="share-panel">
					<h4>Partage ciblé</h4>
					<p class="share-hint">
						Choisissez une ou plusieurs formations, promos, ou des utilisateurs précis.
					</p>

					<div class="share-section">
						<div class="share-title">Formations</div>
						<div class="choice-row">
							{#each availableFormations as formation}
								<button
									type="button"
									class="chip {selectedFormations.includes(formation) ? 'active' : ''}"
									onclick={() =>
										selectedFormations.includes(formation)
											? removeFormation(formation)
											: addFormation(formation)}
								>
									{formation}
								</button>
							{/each}
						</div>
					</div>

					<div class="share-section">
						<div class="share-title">Promotions</div>
						{#if selectedPromos.length > 0}
							<div class="choice-row">
								{#each selectedPromos as promo}
									<button
										type="button"
										class="selected-chip"
										onclick={() => removePromo(promo)}
										title="Supprimer la promo {promo}"
									>
										<span>{promo}</span>
										<X size={12} />
									</button>
								{/each}
							</div>
						{:else}
							<p class="no-promos">Aucune promotion sélectionnée</p>
						{/if}
						<div class="promo-add-row">
							<select
								bind:value={promoSelectorYear}
								class="promo-select"
								disabled={loading}
							>
								{#each promoYears as year}
									<option value={year}>{year}</option>
								{/each}
							</select>
							<button
								type="button"
								class="promo-add-btn"
								onclick={addPromoFromSelector}
								disabled={loading || selectedPromos.includes(promoSelectorYear)}
								aria-label="Ajouter la promotion sélectionnée"
								title={selectedPromos.includes(promoSelectorYear)
									? 'Déjà ajoutée'
									: 'Ajouter cette promotion'}
							>
								<Plus size={18} strokeWidth={2.5} />
							</button>
						</div>
					</div>

					<div class="share-section">
						<label for="userSearch" class="share-title">Utilisateurs spécifiques</label>
						<div class="search-box">
							<Search size={16} />
							<input
								id="userSearch"
								type="text"
								bind:value={userSearch}
								onfocus={() => (showUserSuggestions = true)}
								onblur={() => {
									setTimeout(() => {
										showUserSuggestions = false;
									}, 120);
								}}
								placeholder="Rechercher par nom, prénom ou identifiant"
								disabled={loading}
							/>
						</div>

						{#if showUserSuggestions && userSuggestions.length > 0}
							<div class="suggestions">
								{#each userSuggestions as user}
									<button type="button" class="suggestion" onclick={() => addUser(user)}>
										<span class="s-main">{userLabel(user)}</span>
										<span class="suggestion-add" aria-hidden="true">
											<Plus size={16} strokeWidth={2.6} />
										</span>
									</button>
								{/each}
							</div>
						{/if}

						{#if selectedUsers.length > 0}
							<div class="selected-list">
								{#each selectedUsers as user}
									<button type="button" class="selected-chip" onclick={() => removeUser(user.id_user)}>
										<span>{userLabel(user)}</span>
										<X size={14} />
									</button>
								{/each}
							</div>
						{/if}
					</div>
				</div>
			{/if}

			<button type="submit" style="display: none;" tabindex="-1" aria-hidden="true"></button>
		</form>
	{/if}
</Modal>

<style>
	.loading-state {
		text-align: center;
		padding: 3rem 1rem;
		color: var(--text-primary);
	}

	.loading-state p {
		margin-top: 1rem;
		color: var(--text-secondary);
	}

	.error-message {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 1rem;
		background: rgba(239, 68, 68, 0.1);
		border: 1px solid rgba(239, 68, 68, 0.3);
		border-radius: 8px;
		color: rgba(255, 100, 100, 0.9);
		margin-bottom: 1.5rem;
	}

	.error-message p {
		margin: 0;
		font-size: 0.875rem;
	}

	form {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	.meta-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.8rem;
	}

	.form-group {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.form-group label,
	.share-title {
		color: var(--text-primary);
		font-weight: 600;
		font-size: 0.875rem;
	}

	.form-group input,
	.form-group select,
	.search-box input {
		background: var(--bg-tertiary);
		border: 1px solid var(--border);
		color: var(--text-primary);
		padding: 0.75rem;
		border-radius: 10px;
		font-size: 0.9rem;
		transition: all 0.2s ease;
	}

	.search-box {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0 0.6rem;
		border: 1px solid var(--border);
		border-radius: 10px;
		background: var(--bg-tertiary);
	}

	.search-box input {
		border: 0;
		padding: 0.65rem 0;
		background: transparent;
		width: 100%;
	}

	.form-group input:focus,
	.form-group select:focus,
	.search-box:focus-within {
		outline: none;
		border-color: var(--accent);
	}

	.form-group-checkbox label {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		font-size: 0.9rem;
	}

	.share-panel {
		border: 1px solid var(--border);
		background: color-mix(in oklab, var(--bg-tertiary) 90%, transparent);
		border-radius: 12px;
		padding: 0.9rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.share-panel h4 {
		margin: 0;
		font-size: 1rem;
	}

	.share-hint {
		margin: 0;
		font-size: 0.82rem;
		color: var(--text-secondary);
	}

	.share-section {
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
		position: relative;
	}

	.choice-row,
	.selected-list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.45rem;
	}

	.promo-add-row {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}

	.promo-select {
		flex: 1;
		background: var(--bg-tertiary);
		border: 1px solid var(--border);
		color: var(--text-primary);
		padding: 0.55rem 0.65rem;
		border-radius: 10px;
		font-size: 0.9rem;
		cursor: pointer;
		transition: border-color 0.2s;
	}

	.promo-select:focus {
		outline: none;
		border-color: var(--accent);
	}

	.promo-add-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2.1rem;
		height: 2.1rem;
		border-radius: 50%;
		border: none;
		background: var(--accent);
		color: white;
		cursor: pointer;
		flex-shrink: 0;
		transition: opacity 0.15s;
	}

	.promo-add-btn :global(svg) {
		display: block;
		width: 1rem;
		height: 1rem;
	}

	.promo-add-btn:not(:disabled):hover {
		opacity: 0.82;
	}

	.promo-add-btn:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}

	.no-promos {
		margin: 0;
		font-size: 0.82rem;
		color: var(--text-secondary);
		font-style: italic;
	}

	.chip,
	.selected-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.4rem 0.65rem;
		border-radius: 999px;
		border: 1px solid var(--border);
		background: var(--bg-secondary);
		color: var(--text-primary);
		font-size: 0.82rem;
		cursor: pointer;
	}

	.chip.active {
		border-color: var(--accent);
		background: color-mix(in oklab, var(--accent) 20%, var(--bg-secondary));
	}

	.selected-chip {
		border-color: color-mix(in oklab, var(--accent) 50%, var(--border));
	}

	.suggestions {
		max-height: 240px;
		overflow: auto;
		border: 1px solid var(--border);
		border-radius: 10px;
		background: var(--bg-secondary);
	}

	.suggestion {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
		padding: 0.55rem 0.7rem;
		border: 0;
		background: transparent;
		text-align: left;
		color: var(--text-primary);
		cursor: pointer;
	}

	.suggestion:hover {
		background: color-mix(in oklab, var(--accent) 12%, transparent);
	}

	.s-main {
		font-size: 0.86rem;
	}

	.suggestion-add {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.4rem;
		height: 1.4rem;
		border-radius: 50%;
		background: color-mix(in oklab, var(--accent) 82%, black 4%);
		color: white;
		flex-shrink: 0;
	}

	.suggestion-add :global(svg) {
		display: block;
		width: 0.95rem;
		height: 0.95rem;
	}

	@media (max-width: 640px) {
		.meta-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
