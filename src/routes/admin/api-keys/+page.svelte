<script lang="ts">
	import { onMount } from 'svelte';
	import { Key, Book, CirclePlus, Check, Info, AlertCircle, RefreshCw, Trash2 } from 'lucide-svelte';
	import BackgroundBlobs from '$lib/components/BackgroundBlobs.svelte';
	import Spinner from '$lib/components/Spinner.svelte';
	import { showConfirm } from '$lib/confirm';
	import { toast } from '$lib/toast';

	type KeyRow = { id: number; label?: string; scopes?: string | null; created_at: number };

	let keys: KeyRow[] = $state([]);
	let loading = $state(true);
	let error: string | null = $state(null);

	let newLabel = $state('');
	let newScopes = $state('');
	let creating = $state(false);

	async function loadKeys() {
		loading = true;
		error = null;
		try {
			const res = await fetch('/api/admin/api-keys');
			if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
			const data = (await res.json()) as { keys: KeyRow[] };
			keys = data.keys || [];
		} catch (e: unknown) {
			error = (e as Error).message;
		} finally {
			loading = false;
		}
	}

	async function createKey() {
		if (!newLabel) {
			toast.error('Un label est requis');
			return;
		}
		creating = true;
		try {
			const body = {
				label: newLabel || undefined,
				scopes: newScopes ? newScopes.split(',').map((s) => s.trim()) : undefined
			};
			const res = await fetch('/api/admin/api-keys', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
			const data = (await res.json()) as { id: number; rawKey: string };

			await showConfirm(
				`Clé créée avec succès !\n\nID: ${data.id}\nClé: ${data.rawKey}\n\n⚠️ Copiez-la maintenant, elle ne sera plus jamais affichée.`,
				'Clé API générée'
			);

			newLabel = '';
			newScopes = '';
			await loadKeys();
		} catch (e: unknown) {
			toast.error('Erreur lors de la création: ' + (e as Error).message);
		} finally {
			creating = false;
		}
	}

	async function deleteKey(id: number) {
		const ok = await showConfirm(
			"Supprimer définitivement cette clé ?\nCette action révoquera immédiatement l'accès.",
			'Supprimer la clé'
		);
		if (!ok) return;
		try {
			const res = await fetch(`/api/admin/api-keys/${id}`, { method: 'DELETE' });
			if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
			toast.success('Clé supprimée');
			await loadKeys();
		} catch (e: unknown) {
			toast.error('Erreur: ' + (e as Error).message);
		}
	}

	onMount(() => {
		loadKeys();
	});
</script>

<svelte:head>
	<title>Admin — API Keys</title>
</svelte:head>

<div role="main" class="admin-main">
	<!-- Animated background -->
	<BackgroundBlobs />

	<div class="admin-container">
		<header class="page-header">
			<div class="header-icon">
				<Key size={32} />
			</div>
			<div class="header-content">
				<h1>Gestion des clés API</h1>
				<p class="subtitle">Gérez les accès externes à l'API MiGallery</p>
			</div>
			<div style="margin-left: auto;">
				<a href="/admin/api-docs" class="btn-glass">
					<Book size={16} /> Documentation
				</a>
			</div>
		</header>

		<!-- Create section -->
		<section class="glass-card create-section">
			<div class="card-header">
				<h3><CirclePlus size={20} /> Nouvelle clé</h3>
			</div>
			<div class="card-body">
				<div class="form-row">
					<div class="input-group">
						<label for="key-label">Label</label>
						<input
							id="key-label"
							class="input-glass"
							placeholder="Ex: portail-etu"
							bind:value={newLabel}
						/>
					</div>
					<div class="input-group flex-1">
						<label for="key-scopes">Scopes (optionnel)</label>
						<input
							id="key-scopes"
							class="input-glass"
							placeholder="Ex: read,write (séparés par virgule)"
							bind:value={newScopes}
						/>
					</div>
					<div class="input-group button-group">
						<button type="button" class="btn-glass primary" onclick={createKey} disabled={creating || !newLabel}>
							{#if creating}
								<Spinner size={18} /> Création...
							{:else}
								<Check size={18} /> Créer
							{/if}
						</button>
					</div>
				</div>
				<p class="hint-text">
					<Info size={14} /> La clé brute ne sera affichée qu'une seule fois après la création.
				</p>
			</div>
		</section>

		{#if error}
			<div class="glass-card p-4 border-l-4 border-red-500 text-red-500 flex items-center gap-2">
				<AlertCircle size={20} />
				{error}
			</div>
		{/if}

		<!-- Liste des clés -->
		<section class="glass-card list-section">
			<div class="card-header">
				<h3>Clés existantes ({keys.length})</h3>
				<button
					type="button"
					class="btn-refresh"
					onclick={loadKeys}
					disabled={loading}
					title="Rafraîchir"
					class:animate-spin={loading}
				>
					<RefreshCw size={18} />
				</button>
			</div>

			{#if loading && keys.length === 0}
				<div class="empty-state"><Spinner size={32} /> Chargement...</div>
			{:else if keys.length > 0}
				<div class="table-container">
					<table>
						<thead>
							<tr>
								<th>ID</th>
								<th>Label</th>
								<th>Scopes</th>
								<th>Créée le</th>
								<th class="text-right">Actions</th>
							</tr>
						</thead>
						<tbody>
							{#each keys as k}
								<tr>
									<td class="id-cell">#{k.id}</td>
									<td class="font-medium text-main">{k.label || '-'}</td>
									<td>
										{#if k.scopes}
											<div class="scopes-list">
												{#each k.scopes.split(',') as scope}
													<span class="badge scope">{scope.trim()}</span>
												{/each}
											</div>
										{:else}
											<span class="badge all">Tous</span>
										{/if}
									</td>
									<td class="text-sm text-muted">{new Date(k.created_at).toLocaleString()}</td>
									<td class="text-right">
										<button type="button" class="btn-icon danger" onclick={() => deleteKey(k.id)} title="Révoquer">
											<Trash2 size={18} />
										</button>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{:else if !loading}
				<div class="empty-state">
					<Key size={48} />
					<p>Aucune clé API active.</p>
				</div>
			{/if}
		</section>
	</div>
</div>

<style>
	/* Uses the global theme tokens directly (no per-page mirror variables). */
	.admin-main {
		position: relative;
		min-height: 100vh;
		color: var(--text-primary);
		background-color: var(--bg-primary);
		overflow-x: hidden;
		padding: 2rem 1rem 6rem;
		border-radius: 1.5rem;
	}

	.admin-container {
		position: relative;
		z-index: 1;
		max-width: 1000px;
		margin: 0 auto;
	}

	/* --- HEADER --- */
	.page-header {
		display: flex;
		align-items: center;
		gap: 1.5rem;
		margin-bottom: 3rem;
	}
	.header-icon {
		width: 56px;
		height: 56px;
		background: var(--gradient-brand);
		color: white;
		border-radius: var(--radius);
		display: flex;
		align-items: center;
		justify-content: center;
		box-shadow: 0 8px 20px -4px color-mix(in srgb, var(--accent) 50%, transparent);
	}
	.page-header h1 {
		font-size: 2rem;
		font-weight: 800;
		margin: 0;
		line-height: 1.1;
		letter-spacing: -0.02em;
	}
	.subtitle {
		color: var(--text-secondary);
		font-size: 1rem;
		margin: 0.25rem 0 0;
	}

	/* Buttons use the canonical .btn-glass from app.css. */

	/* --- CARDS --- */
	.glass-card {
		background: var(--glass-bg);
		backdrop-filter: blur(20px);
		-webkit-backdrop-filter: blur(20px);
		border: 1px solid var(--glass-border);
		border-radius: var(--radius-lg);
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.05);
		overflow: hidden;
		margin-bottom: 2rem;
	}

	.card-header {
		padding: 1.25rem 1.5rem;
		border-bottom: 1px solid var(--border);
		display: flex;
		justify-content: space-between;
		align-items: center;
		background: rgba(255, 255, 255, 0.02);
	}
	.card-header h3 {
		margin: 0;
		font-size: 1.1rem;
		font-weight: 700;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		color: var(--text-primary);
	}
	.card-body {
		padding: 1.5rem;
	}

	/* --- FORM --- */
	.form-row {
		display: flex;
		gap: 1rem;
		align-items: flex-end;
		flex-wrap: wrap;
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
	.input-group.flex-1 {
		flex: 1;
		min-width: 200px;
	}

	.input-glass {
		padding: 0.75rem 1rem;
		background: var(--glass-bg);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		font-size: 0.95rem;
		color: var(--text-primary);
		transition: all 0.2s;
	}
	.input-glass:focus {
		outline: none;
		border-color: var(--accent);
		background: var(--bg-tertiary);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 15%, transparent);
	}

	.button-group {
		padding-bottom: 1px;
	}


	.hint-text {
		margin-top: 1rem;
		font-size: 0.85rem;
		color: var(--text-secondary);
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	/* --- TABLE --- */
	.table-container {
		overflow-x: auto;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		min-width: 700px;
	}

	th {
		text-align: left;
		padding: 1rem 1.5rem;
		font-size: 0.8rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-secondary);
		border-bottom: 1px solid var(--border);
		background: rgba(0, 0, 0, 0.02);
	}

	td {
		padding: 1rem 1.5rem;
		border-bottom: 1px solid var(--border);
		font-size: 0.95rem;
		vertical-align: middle;
		color: var(--text-primary);
	}

	tr:last-child td {
		border-bottom: none;
	}
	tr:hover td {
		background: var(--bg-tertiary);
	}

	.id-cell {
		font-family: monospace;
		color: var(--text-secondary);
		font-size: 0.85rem;
	}
	.text-right {
		text-align: right;
	}
	.text-muted {
		color: var(--text-secondary);
	}
	.text-main {
		color: var(--text-primary);
	}
	.text-sm {
		font-size: 0.85rem;
	}
	.font-medium {
		font-weight: 500;
	}

	.scopes-list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
	}

	.badge {
		display: inline-block;
		padding: 0.2rem 0.6rem;
		border-radius: 6px;
		font-size: 0.75rem;
		font-weight: 700;
		font-family: monospace;
	}
	.badge.scope {
		background: color-mix(in srgb, var(--accent) 15%, transparent);
		color: var(--accent);
		border: 1px solid color-mix(in srgb, var(--accent) 20%, transparent);
	}
	.badge.all {
		background: color-mix(in srgb, var(--success) 15%, transparent);
		color: var(--success);
		border: 1px solid color-mix(in srgb, var(--success) 20%, transparent);
	}

	.btn-refresh {
		background: transparent;
		border: none;
		color: var(--text-secondary);
		cursor: pointer;
		padding: 0.5rem;
		border-radius: var(--radius-xs);
		transition: all 0.2s;
	}
	.btn-refresh:hover {
		background: var(--bg-tertiary);
		color: var(--accent);
	}
	.animate-spin {
		animation: spin 1s linear infinite;
	}
	@keyframes spin {
		100% {
			transform: rotate(360deg);
		}
	}

	.btn-icon.danger {
		background: color-mix(in srgb, var(--error) 10%, transparent);
		color: var(--error);
		width: 36px;
		height: 36px;
		border-radius: var(--radius-sm);
		border: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		transition: all 0.2s;
	}
	.btn-icon.danger:hover {
		background: var(--error);
		color: white;
		transform: translateY(-2px);
	}

	.empty-state {
		padding: 4rem 2rem;
		text-align: center;
		color: var(--text-secondary);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
		opacity: 0.7;
	}

	@media (max-width: 640px) {
		.page-header {
			flex-direction: column;
			align-items: flex-start;
			gap: 1rem;
		}
		.header-icon {
			display: none;
		}
		.page-header h1 {
			font-size: 1.5rem;
		}
		.form-row {
			flex-direction: column;
			align-items: stretch;
		}
		.button-group {
			align-self: stretch;
		}
	}
</style>
