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

<div class="admin-wrapper">
    <header class="view-header">
        <div class="icon-box"><Users size={26} /></div>
        <div class="title-box">
            <h1>Utilisateurs & rôles</h1>
            <p class="count-subtitle">{users.length} utilisateur{users.length > 1 ? 's' : ''}</p>
        </div>
    </header>

    <div class="search-bar">
        <Search size={16} />
        <input
            type="search"
            placeholder="Rechercher (nom, promo, formation, rôle)…"
            bind:value={searchQuery}
        />
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
                                {#if isSelf}<span class="badge self-tag">vous</span>{/if}
                            </div>
                            <div class="identity-meta-line">
                                {#if user.promo}<span class="badge promo-tag">{user.promo}</span>{/if}
                                {#if user.formation}<span class="txt-formation">{user.formation}</span>{/if}
                            </div>
                        </div>
                    </div>

                    <div class="row-actions">
                        <div class="select-wrapper">
                            <select
                                class="action-select role-{user.role || 'user'}"
                                value={user.role || 'user'}
                                disabled={savingId === user.id_user || isSelf}
                                title={isSelf ? 'Vous ne pouvez pas modifier votre propre rôle' : 'Changer le rôle'}
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
                            title={isSelf ? 'Vous ne pouvez pas vous supprimer' : 'Supprimer'}
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
                        title="Aucun résultat"
                        description="Aucun utilisateur ne correspond à la recherche."
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

    /* En-tête */
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

    /* Barre de recherche */
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
        box-shadow: 0 2px 8px rgba(0,0,0,0.02);
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

    /* Conteneur de la table (Look unifié) */
    .data-table-container {
        background: var(--bg-secondary);
        border: 1px solid var(--border);
        border-radius: var(--radius-lg);
        overflow: hidden; /* Coupe les bordures des lignes aux extrémités */
        box-shadow: 0 4px 20px rgba(0,0,0,0.05);
    }

    .data-list {
        display: flex;
        flex-direction: column;
    }

    /* Ligne individuelle */
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

    /* Section Gauche (Infos) */
    .row-identity {
        display: flex;
        align-items: center;
        gap: 1.25rem;
        flex: 1;
        min-width: 0; /* Vital pour la troncature du texte */
    }

    /* FORCER l'alignement à gauche pour casser l'ancien comportement global */
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

    /* Section Droite (Actions) */
    .row-actions {
        display: flex;
        align-items: center;
        gap: 0.75rem;
    }

    /* Select Personnalisé */
    .select-wrapper {
        position: relative;
    }

    /* Flèche personnalisée intégrée au select */
    .select-wrapper::after {
        content: '';
        position: absolute;
        right: 0.8rem;
        top: 50%;
        transform: translateY(-50%);
        width: 14px;
        height: 14px;
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
        background-size: contain;
        background-repeat: no-repeat;
        pointer-events: none;
        color: var(--text-muted);
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

    /* Couleurs de rôles dans le select ! */
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

    /* Bouton Supprimer */
    .action-btn-delete {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 36px;
        background: transparent;
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        color: var(--text-muted);
        cursor: pointer;
        transition: all 0.2s ease;
    }

    .action-btn-delete:hover:not(:disabled) {
        border-color: var(--error);
        color: var(--error);
        background: color-mix(in srgb, var(--error) 10%, transparent);
    }

    .action-btn-delete:disabled {
        opacity: 0.4;
        cursor: not-allowed;
    }

    .empty-wrap {
        padding: 3rem 1rem;
    }

    /* Adaptation Mobile */
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
