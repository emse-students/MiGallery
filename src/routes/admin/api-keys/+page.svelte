<script lang="ts">
	import { onMount } from 'svelte';
	import { Key, Book, CirclePlus, Check, Info, AlertCircle, RefreshCw, Trash2 } from 'lucide-svelte';
	import AdminPage from '$lib/components/AdminPage.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Spinner from '$lib/components/Spinner.svelte';
	import { showConfirm } from '$lib/confirm';
	import { toast } from '$lib/toast';
	import { m } from '$lib/paraglide/messages';

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
			toast.error(m.apik_label_required());
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
				m.apik_created_body({ id: data.id, key: data.rawKey }),
				m.apik_created_title()
			);

			newLabel = '';
			newScopes = '';
			await loadKeys();
		} catch (e: unknown) {
			toast.error(m.apik_create_error({ error: (e as Error).message }));
		} finally {
			creating = false;
		}
	}

	async function deleteKey(id: number) {
		const ok = await showConfirm(m.apik_delete_confirm(), m.apik_delete_title());
		if (!ok) return;
		try {
			const res = await fetch(`/api/admin/api-keys/${id}`, { method: 'DELETE' });
			if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
			toast.success(m.apik_deleted());
			await loadKeys();
		} catch (e: unknown) {
			toast.error(m.common_error_detail({ error: (e as Error).message }));
		}
	}

	onMount(() => {
		loadKeys();
	});
</script>

<svelte:head>
	<title>{m.apik_page_title()}</title>
</svelte:head>

<AdminPage
	title={m.apik_title()}
	subtitle={m.apik_subtitle()}
	icon={Key}
	maxWidth="1000px"
>
	{#snippet actions()}
		<a href="/admin" class="btn-glass">
			<Book size={16} /> {m.adm_nav_docs()}
		</a>
	{/snippet}

		<!-- Create section -->
		<section class="glass-card create-section">
			<div class="card-header">
				<h3><CirclePlus size={20} /> {m.apik_new_key()}</h3>
			</div>
			<div class="card-body">
				<div class="form-row">
					<div class="input-group">
						<label for="key-label">{m.apik_label()}</label>
						<input
							id="key-label"
							class="input-glass"
							placeholder={m.apik_label_ph()}
							bind:value={newLabel}
						/>
					</div>
					<div class="input-group flex-1">
						<label for="key-scopes">{m.apik_scopes()}</label>
						<input
							id="key-scopes"
							class="input-glass"
							placeholder={m.apik_scopes_ph()}
							bind:value={newScopes}
						/>
					</div>
					<div class="input-group button-group">
						<button type="button" class="btn-glass primary" onclick={createKey} disabled={creating || !newLabel}>
							{#if creating}
								<Spinner size={18} /> {m.apik_creating()}
							{:else}
								<Check size={18} /> {m.apik_create()}
							{/if}
						</button>
					</div>
				</div>
				<p class="hint-text">
					<Info size={14} /> {m.apik_hint()}
				</p>
			</div>
		</section>

		{#if error}
			<div class="glass-card p-4 border-l-4 border-red-500 text-red-500 flex items-center gap-2">
				<AlertCircle size={20} />
				{error}
			</div>
		{/if}

		<!-- Keys list -->
		<section class="glass-card list-section">
			<div class="card-header">
				<h3>{m.apik_existing({ count: keys.length })}</h3>
				<button
					type="button"
					class="btn-refresh"
					onclick={loadKeys}
					disabled={loading}
					title={m.common_refresh()}
					class:animate-spin={loading}
				>
					<RefreshCw size={18} />
				</button>
			</div>

			{#if loading && keys.length === 0}
				<div class="empty-state"><Spinner size={32} /> {m.common_loading()}</div>
			{:else if keys.length > 0}
				<div class="table-container">
					<table>
						<thead>
							<tr>
								<th>ID</th>
								<th>{m.apik_label()}</th>
								<th>Scopes</th>
								<th>{m.apik_th_created()}</th>
								<th class="text-right">{m.apik_th_actions()}</th>
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
											<span class="badge all">{m.apik_all_scopes()}</span>
										{/if}
									</td>
									<td class="text-sm text-muted">{new Date(k.created_at).toLocaleString()}</td>
									<td class="text-right">
										<button type="button" class="btn-icon danger" onclick={() => deleteKey(k.id)} title={m.apik_revoke()}>
											<Trash2 size={18} />
										</button>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{:else if !loading}
				<EmptyState icon={Key} title={m.apik_empty()} />
			{/if}
		</section>
</AdminPage>

<style>
	/* Uses the global theme tokens directly (no per-page mirror variables). */

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
		padding: 0;
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
		.form-row {
			flex-direction: column;
			align-items: stretch;
		}
		.button-group {
			align-self: stretch;
		}
	}
</style>
