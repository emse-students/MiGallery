<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import Icon from './Icon.svelte';
	import Spinner from './Spinner.svelte';

	interface Props {
		albumId: string;
		onClose: () => void;
		onAlbumUpdated?: () => void;
	}

	  let {
    albumId,
    onClose,
    onAlbumUpdated
  }: Props = $props();
  
  // S'assurer que albumId est une string pure, pas un Proxy
  const safeAlbumId = String(albumId);

  console.log('✓ [EditAlbumModal] Composant chargé');

	let albumName = $state('');
	let albumDate = $state('');
	let albumLocation = $state('');
	let albumVisibility = $state<'private' | 'authenticated' | 'unlisted'>('private');
	let albumVisible = $state(true);
	let albumTags = $state('');
	let albumAllowedUsers = $state('');
	let loading = $state(false);
	let loadingData = $state(true);
	let error = $state<string | null>(null);

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose();
	}

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) onClose();
	}

	async function loadAlbumData() {
		loadingData = true;
		error = null;

		try {
			const res = await fetch(`/api/albums/${safeAlbumId}/info`);
			
			if (!res.ok) {
				const errorData = await res.json().catch(() => ({}));
				throw new Error(errorData.error || 'Erreur lors du chargement de l\'album');
			}

			const result = await res.json();
			
			if (!result.success || !result.album) {
				throw new Error('Album non trouvé');
			}

			const album = result.album;
			albumName = album.name || '';
			albumDate = album.date || '';
			albumLocation = album.location || '';
			albumVisibility = album.visibility || 'private';
			albumVisible = album.visible === 1;
			albumTags = (result.tags || []).join(', ');
			albumAllowedUsers = (result.users || []).join(', ');
		} catch (e) {
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

		try {
			// Mettre à jour l'album via PATCH (métadonnées locales uniquement)
			const res = await fetch(`/api/albums/${safeAlbumId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: albumName.trim(),
					date: albumDate || null,
					location: albumLocation.trim() || null,
					visibility: albumVisibility,
					visible: albumVisible,
					tags: albumTags.split(',').map(t => t.trim()).filter(Boolean),
					allowedUsers: albumAllowedUsers.split(',').map(u => u.trim()).filter(Boolean)
				})
			});

			if (!res.ok) {
				const errData = await res.json().catch(() => ({}));
				throw new Error(errData.error || 'Erreur lors de la mise à jour de l\'album');
			}

			// Succès
			if (onAlbumUpdated) await onAlbumUpdated();
			onClose();
		} catch (e) {
			error = (e as Error).message;
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		window.addEventListener('keydown', handleKeydown);
		document.body.classList.add('modal-open');
		loadAlbumData();
	});

	onDestroy(() => {
		window.removeEventListener('keydown', handleKeydown);
		document.body.classList.remove('modal-open');
	});
</script>

<div class="modal-backdrop" onclick={handleBackdropClick} role="button" tabindex="-1" onkeydown={(e) => { if (e.key === 'Escape') onClose(); }}>
	<div class="modal-content">
		<div class="modal-header">
			<div class="modal-title">
				<Icon name="edit" size={24} />
				<span>Modifier l'album</span>
			</div>
			<button class="btn-icon" onclick={onClose} title="Fermer">
				<Icon name="x" size={24} />
			</button>
		</div>

		<div class="modal-body">
			{#if error}
				<div class="error-message">
					<Icon name="alert-circle" size={20} />
					<p>{error}</p>
				</div>
			{/if}

			{#if loadingData}
				<div class="loading-state">
					<Spinner size={40} />
					<p>Chargement des données...</p>
				</div>
			{:else}
				<form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
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

					<div class="form-group">
						<label for="albumDate">Date (optionnel)</label>
						<input
							id="albumDate"
							type="date"
							bind:value={albumDate}
							disabled={loading}
						/>
					</div>

					<div class="form-group">
						<label for="albumLocation">Lieu (optionnel)</label>
						<input
							id="albumLocation"
							type="text"
							bind:value={albumLocation}
							placeholder="Ex: Campus Mines Saint-Étienne"
							disabled={loading}
						/>
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

					<div class="form-group">
						<label for="albumTags">
							Tags (séparés par des virgules)
							<span class="label-hint">Ex: Promo 2024, VIP, Soirée</span>
						</label>
						<input
							id="albumTags"
							type="text"
							bind:value={albumTags}
							placeholder="Promo 2024, VIP"
							disabled={loading}
						/>
					</div>

					<div class="form-group">
						<label for="albumAllowedUsers">
							Utilisateurs autorisés (id_user séparés par des virgules)
							<span class="label-hint">Ex: alice.bob, john.doe</span>
						</label>
						<input
							id="albumAllowedUsers"
							type="text"
							bind:value={albumAllowedUsers}
							placeholder="alice.bob, john.doe"
							disabled={loading}
						/>
					</div>

					<div class="modal-actions">
						<button type="button" class="btn-secondary" onclick={onClose} disabled={loading}>
							Annuler
						</button>
						<button type="submit" class="btn-primary" disabled={loading}>
							{#if loading}
								<Spinner size={18} />
								<span>Enregistrement...</span>
							{:else}
								<Icon name="save" size={18} />
								<span>Enregistrer</span>
							{/if}
						</button>
					</div>
				</form>
			{/if}
		</div>
	</div>
</div>

<style>
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.9);
		backdrop-filter: blur(20px);
		z-index: 1000;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		animation: fadeIn 0.2s ease-out;
	}

	@keyframes fadeIn {
		from { opacity: 0; }
		to { opacity: 1; }
	}

	.modal-content {
		width: 100%;
		max-width: 650px;
		max-height: 90vh;
		background: rgba(255, 255, 255, 0.05);
		border-radius: 16px;
		backdrop-filter: blur(20px);
		border: 1px solid rgba(255, 255, 255, 0.1);
		animation: slideUp 0.3s cubic-bezier(0.4, 0, 0.2, 1);
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	@keyframes slideUp {
		from {
			transform: translateY(20px);
			opacity: 0;
		}
		to {
			transform: translateY(0);
			opacity: 1;
		}
	}

	.modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1.5rem;
		border-bottom: 1px solid rgba(255, 255, 255, 0.1);
	}

	.modal-title {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		color: white;
		font-size: 1.25rem;
		font-weight: 600;
	}

	.btn-icon {
		background: rgba(255, 255, 255, 0.1);
		border: none;
		color: white;
		padding: 0.5rem;
		border-radius: 8px;
		cursor: pointer;
		transition: all 0.2s ease;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.btn-icon:hover {
		background: rgba(255, 255, 255, 0.2);
		transform: scale(1.05);
	}

	.modal-body {
		padding: 1.5rem;
		overflow-y: auto;
		flex: 1;
	}

	.loading-state {
		text-align: center;
		padding: 3rem 1rem;
		color: white;
	}

	.loading-state p {
		margin-top: 1rem;
		color: rgba(255, 255, 255, 0.7);
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

	.form-group {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.form-group label {
		color: rgba(255, 255, 255, 0.9);
		font-weight: 500;
		font-size: 0.875rem;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.label-hint {
		color: rgba(255, 255, 255, 0.5);
		font-weight: 400;
		font-size: 0.75rem;
	}

	.form-group input,
	.form-group select {
		background: rgba(255, 255, 255, 0.05);
		border: 1px solid rgba(255, 255, 255, 0.2);
		color: white;
		padding: 0.75rem;
		border-radius: 8px;
		font-size: 0.875rem;
		transition: all 0.2s ease;
	}

	.form-group select {
		background: rgba(30, 30, 40, 0.95);
	}

	.form-group select option {
		background: rgba(30, 30, 40, 1);
		color: white;
		padding: 0.5rem;
	}

	.form-group input:focus,
	.form-group select:focus {
		outline: none;
		border-color: var(--accent);
		background: rgba(255, 255, 255, 0.08);
	}

	.form-group input::placeholder {
		color: rgba(255, 255, 255, 0.4);
	}

	.form-group input:disabled,
	.form-group select:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.form-group-checkbox {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.form-group-checkbox label {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		color: rgba(255, 255, 255, 0.9);
		font-size: 0.875rem;
		cursor: pointer;
	}

	.form-group-checkbox input[type="checkbox"] {
		width: 18px;
		height: 18px;
		cursor: pointer;
		accent-color: var(--accent);
	}

	.modal-actions {
		display: flex;
		gap: 1rem;
		justify-content: flex-end;
		margin-top: 1rem;
		padding-top: 1rem;
		border-top: 1px solid rgba(255, 255, 255, 0.1);
	}

	.btn-secondary,
	.btn-primary {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 1.5rem;
		border-radius: 8px;
		font-weight: 600;
		font-size: 0.875rem;
		cursor: pointer;
		transition: all 0.2s ease;
		border: none;
	}

	.btn-secondary {
		background: rgba(255, 255, 255, 0.1);
		color: white;
	}

	.btn-secondary:hover:not(:disabled) {
		background: rgba(255, 255, 255, 0.15);
	}

	.btn-primary {
		background: linear-gradient(90deg, var(--accent), #8b5cf6);
		color: white;
	}

	.btn-primary:hover:not(:disabled) {
		transform: translateY(-2px);
		box-shadow: 0 8px 24px rgba(59, 130, 246, 0.4);
	}

	.btn-secondary:disabled,
	.btn-primary:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	@media (max-width: 640px) {
		.modal-content {
			max-width: 95vw;
		}

		.modal-actions {
			flex-direction: column;
		}

		.btn-secondary,
		.btn-primary {
			width: 100%;
			justify-content: center;
		}
	}
</style>
