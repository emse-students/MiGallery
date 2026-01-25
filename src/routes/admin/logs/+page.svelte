<script lang="ts">
	import { Activity } from 'lucide-svelte';
	import type { PageData } from './$types';

	let { data } = $props<{ data: PageData }>();
	let logs = $derived(data.logs as any[]);
</script>

<svelte:head>
	<title>Logs Admin - MiGallery</title>
</svelte:head>

<div class="logs-container">
	<header class="page-header">
		<h1><Activity size={28} /> Logs Système</h1>
		<p>Historique des 200 dernières actions</p>
	</header>

	<div class="grid-table glass-card">
		<div class="table-header">
			<div class="cell col-date">Date</div>
			<div class="cell col-actor">Acteur</div>
			<div class="cell col-action">Action</div>
			<div class="cell col-target">Cible</div>
			<div class="cell col-details">Détails</div>
		</div>

		<div class="table-body">
			{#each logs as log}
				<div class="table-row">
					<div class="cell col-date">{new Date(log.timestamp).toLocaleString()}</div>
					<div class="cell col-actor">
						{#if log.actor}
							<span class="badge user">{log.actor}</span>
						{:else}
							<span class="badge system">Système</span>
						{/if}
					</div>
					<div class="cell col-action">
						<span class="action-tag {log.event_type}">{log.event_type}</span>
					</div>
					<div class="cell col-target">
						{#if log.target_type}
							<div class="target-wrapper">
								<span class="target">{log.target_type}</span>
								{#if log.target_id}<span class="target-id">#{log.target_id.substring(0, 8)}...</span>{/if}
							</div>
						{:else}
							<span class="muted">-</span>
						{/if}
					</div>
					<div class="cell col-details" title={log.details}>
						{log.details || '-'}
					</div>
				</div>
			{/each}
		</div>
	</div>
</div>

<style>
	/* Configuration de la grille : C'est ici que l'alignement est garanti */
	/* On définit les largeurs : fixe | fixe | fixe | pourcentage | reste */
	:global(.grid-table) {
		--col-layout: 180px 140px 100px 25% 1fr;
	}

	.logs-container {
		max-width: 1400px;
		margin: 0 auto;
		padding: 2rem;
		color: var(--text-primary);
	}

	.page-header {
		margin-bottom: 2rem;
	}
	.page-header h1 {
		display: flex;
		align-items: center;
		gap: 1rem;
		font-size: 2rem;
		margin-bottom: 0.5rem;
	}

	/* Conteneur principal */
	.glass-card {
		background: var(--bg-secondary);
		border: 1px solid var(--border);
		border-radius: 1rem;
		overflow: hidden;
		display: flex;
		flex-direction: column;
		height: 75vh; /* Hauteur fixe pour permettre le scroll interne */
		box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
	}

	/* Lignes (Header et Row) partagent la MEME définition de grille */
	.table-header,
	.table-row {
		display: grid;
		grid-template-columns: var(--col-layout);
		align-items: center; /* Centrage vertical du texte */
	}

	/* Style de l'en-tête */
	.table-header {
		background: rgba(0, 0, 0, 0.2); /* Fond légèrement plus sombre */
		font-weight: 600;
		color: var(--text-muted);
		text-transform: uppercase;
		font-size: 0.75rem;
		letter-spacing: 0.05em;
		border-bottom: 1px solid var(--border);
		z-index: 10;
		/* Le header reste en haut du conteneur parent */
		flex-shrink: 0;
	}

	/* Zone de scroll pour le contenu */
	.table-body {
		overflow-y: auto;
		flex-grow: 1;
		scrollbar-width: thin;
		scrollbar-color: var(--border) transparent;
	}

	.table-row {
		border-bottom: 1px solid var(--border);
		transition: background 0.1s;
	}
	.table-row:last-child {
		border-bottom: none;
	}
	.table-row:hover {
		background: rgba(255, 255, 255, 0.03);
	}

	/* Cellules */
	.cell {
		padding: 1rem;
		border-right: 1px solid var(--border);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		height: 100%; /* Important pour que la bordure fasse toute la hauteur */
		display: flex;
		align-items: center; /* Centrage vertical du contenu */
	}

	/* Pas de bordure à droite pour la dernière colonne */
	.cell:last-child {
		border-right: none;
	}

	/* --- Styles du contenu (identique à avant) --- */
	.col-date {
		color: var(--text-secondary);
		font-size: 0.9rem;
		font-family: monospace;
	}

	.badge {
		padding: 0.25rem 0.5rem;
		border-radius: 4px;
		font-size: 0.8rem;
		font-weight: 600;
	}
	.badge.user {
		background: rgba(59, 130, 246, 0.15);
		color: #60a5fa;
		border: 1px solid rgba(59, 130, 246, 0.2);
	}
	.badge.system {
		background: rgba(107, 114, 128, 0.15);
		color: #9ca3af;
		border: 1px solid rgba(107, 114, 128, 0.2);
	}

	.action-tag {
		font-family: monospace;
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--accent);
	}
	.action-tag.delete {
		color: #ef4444;
	}
	.action-tag.create {
		color: #10b981;
	}

	.target-wrapper {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.target {
		font-weight: 600;
	}
	.target-id {
		opacity: 0.5;
		font-size: 0.8rem;
		font-family: monospace;
	}
	.muted {
		opacity: 0.3;
	}

	.col-details {
		color: var(--text-secondary);
		font-family: monospace;
		font-size: 0.8rem;
	}
</style>
