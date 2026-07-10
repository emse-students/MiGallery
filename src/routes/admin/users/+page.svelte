<script lang="ts">
	import { Users, Search, Trash2 } from 'lucide-svelte';
	import { invalidateAll } from '$app/navigation';
	import Avatar from '$lib/components/Avatar.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import { fuzzyMatch } from '$lib/fuzzy';
	import { toast } from '$lib/toast';
	import type { PageData } from './$types';
	import type { UserRow } from '$lib/types/api';

	let { data } = $props<{ data: PageData }>();

	const users = $derived(data.users as UserRow[]);
	const currentUserId = $derived(data.currentUserId as string);

	const ROLE_LABELS: Record<string, string> = {
		user: 'Utilisateur',
		mitviste: 'MiTViste',
		admin: 'Admin'
	};
	const ROLES = ['user', 'mitviste', 'admin'];

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
			toast.success(`Rôle de ${user.name} mis à jour`);
			await invalidateAll();
		} catch (e) {
			toast.error(`Échec: ${(e as Error).message}`);
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
			toast.success(`${user.name} supprimé`);
			await invalidateAll();
		} catch (e) {
			toast.error(`Échec: ${(e as Error).message}`);
		} finally {
			savingId = null;
			deleteTarget = null;
		}
	}
</script>

<svelte:head>
	<title>Admin — Utilisateurs</title>
</svelte:head>

<div class="users-page">
	<header class="page-header">
		<div class="header-icon"><Users size={26} /></div>
		<div class="header-text">
			<h1>Utilisateurs & rôles</h1>
			<p class="subtitle">{users.length} utilisateur{users.length > 1 ? 's' : ''}</p>
		</div>
	</header>

	<div class="search-field">
		<Search size={16} />
		<input
			type="search"
			placeholder="Rechercher (nom, promo, formation, rôle)…"
			bind:value={searchQuery}
		/>
	</div>

	<div class="user-list">
		{#each filtered as user (user.id_user)}
			{@const isSelf = user.id_user === currentUserId}
			<div class="user-row">
				<Avatar
					userId={user.id_user}
					firstName={user.first_name}
					lastName={user.last_name}
					name={user.name}
					size={44}
				/>
				<div class="user-info">
					<span class="user-name">{user.name}{#if isSelf}<span class="you-tag">vous</span>{/if}</span>
					<span class="user-meta">
						{#if user.promo}<span class="promo-badge">{user.promo}</span>{/if}
						{#if user.formation}<span>{user.formation}</span>{/if}
					</span>
				</div>

				<select
					class="role-select role-{user.role || 'user'}"
					value={user.role || 'user'}
					disabled={savingId === user.id_user || isSelf}
					title={isSelf ? 'Vous ne pouvez pas modifier votre propre rôle' : 'Changer le rôle'}
					onchange={(e) => changeRole(user, e.currentTarget.value)}
				>
					{#each ROLES as r}
						<option value={r}>{ROLE_LABELS[r]}</option>
					{/each}
				</select>

				<button
					type="button"
					class="btn-glass icon danger"
					disabled={savingId === user.id_user || isSelf}
					title={isSelf ? 'Vous ne pouvez pas vous supprimer' : 'Supprimer'}
					onclick={() => askDelete(user)}
				>
					<Trash2 size={16} />
				</button>
			</div>
		{:else}
			<EmptyState
				icon={Search}
				title="Aucun résultat"
				description="Aucun utilisateur ne correspond à la recherche."
				size="sm"
			/>
		{/each}
	</div>
</div>

<Modal
	bind:show={showDelete}
	type="confirm"
	title="Supprimer l'utilisateur"
	confirmText="Supprimer"
	onConfirm={confirmDelete}
	onCancel={() => (deleteTarget = null)}
>
	<p>
		Supprimer <strong>{deleteTarget?.name}</strong> de la base MiGallery ? Cette action est
		irréversible (les permissions et favoris liés sont aussi supprimés).
	</p>
</Modal>

<style>
	.users-page {
		max-width: 900px;
		margin: 0 auto;
		padding: 2rem;
	}

	.page-header {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-bottom: 1.5rem;
	}
	.header-icon {
		width: 48px;
		height: 48px;
		min-width: 48px;
		background: var(--gradient-brand);
		color: #fff;
		border-radius: var(--radius-md);
		display: flex;
		align-items: center;
		justify-content: center;
		box-shadow: 0 4px 12px color-mix(in srgb, var(--accent) 30%, transparent);
	}
	.page-header h1 {
		font-size: 1.6rem;
		font-weight: 700;
		margin: 0;
	}
	.subtitle {
		color: var(--text-secondary);
		font-size: 0.9rem;
		margin: 0.25rem 0 0;
	}

	.search-field {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		background: var(--bg-secondary);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: 0 0.75rem;
		color: var(--text-muted);
		margin-bottom: 1.25rem;
	}
	.search-field input {
		flex: 1;
		border: none;
		background: transparent;
		color: var(--text-primary);
		padding: 0.65rem 0;
		font-size: 0.9rem;
		outline: none;
	}

	.user-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.user-row {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) 160px auto;
		align-items: center;
		gap: 1rem;
		padding: 0.6rem 1rem;
		background: var(--bg-secondary);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
	}

	.user-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}
	.user-name {
		font-weight: 600;
		color: var(--text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.you-tag {
		margin-left: 0.5rem;
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--accent);
		background: color-mix(in srgb, var(--accent) 12%, transparent);
		padding: 0.1rem 0.4rem;
		border-radius: var(--radius-xs);
	}
	.user-meta {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.85rem;
		color: var(--text-secondary);
	}
	.promo-badge {
		background: color-mix(in srgb, var(--accent) 12%, transparent);
		color: var(--accent);
		padding: 0.1rem 0.45rem;
		border-radius: var(--radius-xs);
		font-weight: 600;
		font-size: 0.8rem;
	}

	.role-select {
		width: 100%;
		background: var(--bg-tertiary);
		border: 1px solid var(--border);
		border-radius: var(--radius-xs);
		color: var(--text-primary);
		padding: 0.4rem 0.6rem;
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
	}
	.role-select:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
	.role-admin {
		color: var(--error);
	}
	.role-mitviste {
		color: var(--edit);
	}

</style>
