<script lang="ts">
	import { Activity, Search, ChevronLeft, ChevronRight, RotateCcw } from 'lucide-svelte';
	import { goto } from '$app/navigation';
	import { m } from '$lib/paraglide/messages';
	import AdminPage from '$lib/components/AdminPage.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import type { PageData } from './$types';

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let { data } = $props<{ data: PageData }>();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let logs = $derived(data.logs as any[]);

	let searchTimer: ReturnType<typeof setTimeout> | null = null;

	function navigate(next: { q?: string; event?: string; page?: number }) {
		const sp = new URLSearchParams();
		const q = next.q ?? data.filters.q;
		const ev = next.event ?? data.filters.eventType;
		const page = next.page ?? 1;
		if (q) sp.set('q', q);
		if (ev) sp.set('event', ev);
		if (page > 1) sp.set('page', String(page));
		const qs = sp.toString();
		goto(qs ? `?${qs}` : '?', { keepFocus: true, noScroll: true });
	}

	function onSearchInput(e: Event & { currentTarget: HTMLInputElement }) {
		const value = e.currentTarget.value;
		if (searchTimer) clearTimeout(searchTimer);
		searchTimer = setTimeout(() => navigate({ q: value, page: 1 }), 300);
	}

	function onEventChange(e: Event & { currentTarget: HTMLSelectElement }) {
		navigate({ event: e.currentTarget.value, page: 1 });
	}

	function resetFilters() {
		if (searchTimer) clearTimeout(searchTimer);
		goto('?', { keepFocus: true, noScroll: true });
	}

	const hasFilters = $derived(!!(data.filters.q || data.filters.eventType));
</script>

<svelte:head>
	<title>{m.logs_page_title()}</title>
</svelte:head>

<AdminPage
	title={m.logs_title()}
	subtitle={m.logs_subtitle({ count: data.total })}
	icon={Activity}
	maxWidth="1400px"
>
	<div class="filter-bar">
		<div class="search-field">
			<Search size={16} />
			<input
				type="search"
				placeholder={m.logs_search_ph()}
				value={data.filters.q}
				oninput={onSearchInput}
			/>
		</div>
		<select class="event-select" value={data.filters.eventType} onchange={onEventChange}>
			<option value="">{m.logs_all_types()}</option>
			{#each data.eventTypes as et}
				<option value={et}>{et}</option>
			{/each}
		</select>
		{#if hasFilters}
			<button type="button" class="btn-glass" onclick={resetFilters}>
				<RotateCcw size={15} /> {m.logs_reset()}
			</button>
		{/if}
	</div>

	<div class="grid-table glass-card">
		<div class="table-header">
			<div class="cell col-date">{m.logs_col_date()}</div>
			<div class="cell col-actor">{m.logs_col_actor()}</div>
			<div class="cell col-action">{m.logs_col_action()}</div>
			<div class="cell col-target">{m.logs_col_target()}</div>
			<div class="cell col-details">{m.logs_col_details()}</div>
		</div>

		<div class="table-body">
			{#each logs as log}
				<div class="table-row">
					<div class="cell col-date">{new Date(log.timestamp).toLocaleString()}</div>
					<div class="cell col-actor">
						{#if log.actor}
							<span class="badge user">{log.actor}</span>
						{:else}
							<span class="badge system">{m.logs_system()}</span>
						{/if}
					</div>
					<div class="cell col-action">
						<span class="action-tag {log.event_type}">{log.event_type}</span>
					</div>
					<div class="cell col-target">
						{#if log.target_type}
							<div class="target-wrapper">
								<span class="target">{log.target_type}</span>
								{#if log.target_id}<span class="target-id">#{log.target_id.substring(0, 8)}...</span
									>{/if}
							</div>
						{:else}
							<span class="muted">-</span>
						{/if}
					</div>
					<div class="cell col-details" title={log.details}>
						{log.details || '-'}
					</div>
				</div>
			{:else}
				<EmptyState
					title={m.logs_empty_title()}
					description={m.logs_empty_desc()}
					size="sm"
				/>
			{/each}
		</div>
	</div>

	<footer class="pager">
		<span class="pager-info">{m.logs_pager({ page: data.page, total: data.pageCount })}</span>
		<div class="pager-actions">
			<button
				type="button"
				class="btn-glass icon"
				disabled={data.page <= 1}
				onclick={() => navigate({ page: data.page - 1 })}
				title={m.logs_prev_page()}
			>
				<ChevronLeft size={18} />
			</button>
			<button
				type="button"
				class="btn-glass icon"
				disabled={data.page >= data.pageCount}
				onclick={() => navigate({ page: data.page + 1 })}
				title={m.logs_next_page()}
			>
				<ChevronRight size={18} />
			</button>
		</div>
	</footer>
</AdminPage>

<style>
	:global(.grid-table) {
		--col-layout: 180px 140px 100px 25% 1fr;
	}

	/* --- FILTER BAR --- */
	.filter-bar {
		display: flex;
		gap: 0.75rem;
		margin-bottom: 1rem;
		flex-wrap: wrap;
		align-items: center;
	}
	.search-field {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex: 1;
		min-width: 220px;
		background: var(--bg-secondary);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: 0 0.75rem;
		color: var(--text-muted);
	}
	.search-field input {
		flex: 1;
		border: none;
		background: transparent;
		color: var(--text-primary);
		padding: 0.6rem 0;
		font-size: 0.9rem;
		outline: none;
	}
	.event-select {
		background: var(--bg-secondary);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		color: var(--text-primary);
		padding: 0.6rem 0.75rem;
		font-size: 0.9rem;
		cursor: pointer;
	}

	.glass-card {
		background: var(--bg-secondary);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		overflow: hidden;
		display: flex;
		flex-direction: column;
		height: 70vh;
		box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
	}

	.table-header,
	.table-row {
		display: grid;
		grid-template-columns: var(--col-layout);
		align-items: center;
	}

	.table-header {
		background: color-mix(in srgb, var(--text-primary) 6%, transparent);
		font-weight: 600;
		color: var(--text-muted);
		text-transform: uppercase;
		font-size: 0.75rem;
		letter-spacing: 0.05em;
		border-bottom: 1px solid var(--border);
		z-index: 10;
		flex-shrink: 0;
	}

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
		background: color-mix(in srgb, var(--text-primary) 3%, transparent);
	}

	.cell {
		padding: 1rem;
		border-right: 1px solid var(--border);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		height: 100%;
		display: flex;
		align-items: center;
	}
	.cell:last-child {
		border-right: none;
	}

	.col-date {
		color: var(--text-secondary);
		font-size: 0.9rem;
		font-family: monospace;
	}

	.badge {
		padding: 0.25rem 0.5rem;
		border-radius: var(--radius-xs);
		font-size: 0.8rem;
		font-weight: 600;
	}
	.badge.user {
		background: color-mix(in srgb, var(--accent) 15%, transparent);
		color: var(--accent);
		border: 1px solid color-mix(in srgb, var(--accent) 20%, transparent);
	}
	.badge.system {
		background: color-mix(in srgb, var(--text-secondary) 15%, transparent);
		color: var(--text-secondary);
		border: 1px solid color-mix(in srgb, var(--text-secondary) 20%, transparent);
	}

	.action-tag {
		font-family: monospace;
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--accent);
	}
	.action-tag.delete {
		color: var(--error);
	}
	.action-tag.create {
		color: var(--success);
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

	/* --- PAGER --- */
	.pager {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-top: 1rem;
		gap: 1rem;
	}
	.pager-info {
		color: var(--text-secondary);
		font-size: 0.9rem;
	}
	.pager-actions {
		display: flex;
		gap: 0.5rem;
	}
</style>
