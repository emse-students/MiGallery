<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import AdminPage from '$lib/components/AdminPage.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import {
		AlertCircle,
		Film,
		FolderPlus,
		ImageOff,
		Images,
		Layers,
		RefreshCw,
		ScanSearch,
		Trash2
	} from '$lib/icons';
	import { m } from '$lib/paraglide/messages';
	import { toast } from '$lib/toast';
	import { showConfirm } from '$lib/confirm';
	import { fuzzySearch } from '$lib/fuzzy';

	interface Untracked {
		id: string;
		name: string;
		assetCount: number;
	}
	interface Ghost {
		id: string;
		name: string;
	}
	interface Inventory {
		immichAlbums: number;
		trackedAlbums: number;
		untracked: Untracked[];
		ghosts: Ghost[];
	}
	interface Orphan {
		id: string;
		fileName: string;
		type: string;
		takenAt: string | null;
	}
	interface MultiAlbum {
		id: string;
		fileName: string;
		type: string;
		albums: Array<{ id: string; name: string }>;
	}
	interface ScanStatus {
		status: 'idle' | 'running' | 'done' | 'error';
		albumsTotal: number;
		albumsDone: number;
		requests: number;
		error: string | null;
		result: {
			scannedAt: number;
			albumsScanned: number;
			albumsFailed: string[];
			assetsSeen: number;
			multiAlbum: MultiAlbum[];
			truncated: boolean;
		} | null;
	}
	interface AlbumOption {
		id: string;
		albumName: string;
		date?: string | null;
	}

	/** Rows rendered at once: the orphan list runs to thousands of entries. */
	const VIEW_SIZE = 100;
	/** Ids per mutation. One request per 4 533 ids would be a 170 KB body. */
	const BATCH = 500;
	/** Multi-album rows rendered. Said out loud rather than truncated silently. */
	const TABLE_LIMIT = 500;

	let inventory = $state<Inventory | null>(null);
	let inventoryError = $state('');
	let inventoryLoading = $state(false);

	let orphans = $state<Orphan[]>([]);
	let orphansLoaded = $state(false);
	let orphansLoading = $state(false);
	let orphansError = $state('');
	let viewStart = $state(0);
	let selected = new SvelteSet<string>();
	let acting = $state(false);

	let albums = $state<AlbumOption[]>([]);
	let pickerOpen = $state(false);
	let pickerQuery = $state('');

	let scan = $state<ScanStatus | null>(null);
	let scanStarting = $state(false);
	let pollTimer: ReturnType<typeof setInterval> | null = null;

	const view = $derived(orphans.slice(viewStart, viewStart + VIEW_SIZE));
	const pickerAlbums = $derived(
		fuzzySearch(albums, pickerQuery, (a) => a.albumName).slice(0, 40)
	);
	const scanRunning = $derived(scan?.status === 'running');

	function errorText(e: unknown): string {
		return e instanceof Error ? e.message : String(e);
	}

	async function loadInventory() {
		inventoryLoading = true;
		inventoryError = '';
		try {
			const res = await fetch('/api/admin/medias');
			if (!res.ok) {
				throw new Error(await res.text().catch(() => res.statusText));
			}
			const data = (await res.json()) as { inventory: Inventory };
			inventory = data.inventory;
		} catch (e: unknown) {
			inventoryError = errorText(e);
		} finally {
			inventoryLoading = false;
		}
	}

	/**
	 * Walk every page of orphans. The endpoint answers one page per request so
	 * each stays inside one outbound budget; the loop is what makes the count
	 * appear progressively instead of after a silent twenty seconds.
	 */
	async function loadOrphans() {
		orphansLoading = true;
		orphansError = '';
		orphans = [];
		selected.clear();
		viewStart = 0;
		try {
			let page: number | null = 1;
			while (page !== null) {
				const res = await fetch(`/api/admin/medias/orphans?page=${page}`);
				if (!res.ok) {
					throw new Error(await res.text().catch(() => res.statusText));
				}
				const data = (await res.json()) as { assets: Orphan[]; nextPage: number | null };
				orphans = [...orphans, ...data.assets];
				page = data.nextPage;
			}
			orphansLoaded = true;
		} catch (e: unknown) {
			orphansError = errorText(e);
		} finally {
			orphansLoading = false;
		}
	}

	function toggle(id: string) {
		if (selected.has(id)) {
			selected.delete(id);
		} else {
			selected.add(id);
		}
	}

	function selectPage() {
		for (const asset of view) {
			selected.add(asset.id);
		}
	}

	function selectAll() {
		for (const asset of orphans) {
			selected.add(asset.id);
		}
	}

	async function loadAlbums() {
		if (albums.length > 0) {
			return;
		}
		try {
			const res = await fetch('/api/albums');
			if (!res.ok) {
				throw new Error(await res.text().catch(() => res.statusText));
			}
			albums = (await res.json()) as AlbumOption[];
		} catch (e: unknown) {
			toast.error(m.med_load_fail({ error: errorText(e) }));
		}
	}

	async function openPicker() {
		pickerQuery = '';
		await loadAlbums();
		pickerOpen = true;
	}

	function batches(ids: string[]): string[][] {
		const out: string[][] = [];
		for (let i = 0; i < ids.length; i += BATCH) {
			out.push(ids.slice(i, i + BATCH));
		}
		return out;
	}

	/** Drop the assets we just filed or trashed: neither is an orphan any more. */
	function forget(ids: string[]) {
		const gone = new Set(ids);
		orphans = orphans.filter((a) => !gone.has(a.id));
		selected.clear();
		if (viewStart >= orphans.length) {
			viewStart = Math.max(0, orphans.length - VIEW_SIZE);
		}
	}

	async function addToAlbum(album: AlbumOption) {
		const ids = [...selected];
		if (ids.length === 0) {
			return;
		}
		pickerOpen = false;
		acting = true;
		try {
			for (const chunk of batches(ids)) {
				// The shared album-add path, so a trashed asset is restored first.
				const res = await fetch(`/api/albums/${album.id}/assets`, {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ ids: chunk })
				});
				if (!res.ok) {
					throw new Error(await res.text().catch(() => res.statusText));
				}
			}
			toast.success(m.med_orphans_add_done({ count: ids.length, album: album.albumName }));
			forget(ids);
		} catch (e: unknown) {
			toast.error(m.med_load_fail({ error: errorText(e) }));
		} finally {
			acting = false;
		}
	}

	async function trashSelected() {
		const ids = [...selected];
		if (ids.length === 0) {
			return;
		}
		const ok = await showConfirm(
			m.med_orphans_trash_confirm({ count: ids.length }),
			m.med_orphans_trash_title()
		);
		if (!ok) {
			return;
		}
		acting = true;
		try {
			for (const chunk of batches(ids)) {
				// force:false is what makes this the trash and not a deletion.
				const res = await fetch('/api/immich/assets', {
					method: 'DELETE',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ ids: chunk, force: false })
				});
				if (!res.ok && res.status !== 204) {
					throw new Error(await res.text().catch(() => res.statusText));
				}
			}
			toast.success(m.med_orphans_trash_done({ count: ids.length }));
			forget(ids);
		} catch (e: unknown) {
			toast.error(m.med_load_fail({ error: errorText(e) }));
		} finally {
			acting = false;
		}
	}

	async function fetchScan() {
		try {
			const res = await fetch('/api/admin/medias/scan');
			if (!res.ok) {
				throw new Error(await res.text().catch(() => res.statusText));
			}
			scan = (await res.json()) as ScanStatus;
			if (scan.status !== 'running') {
				stopPolling();
			}
		} catch {
			// A missed poll is not worth a toast: the next one either works or the
			// scan has finished and the status says so.
			stopPolling();
		}
	}

	function startPolling() {
		if (pollTimer) {
			return;
		}
		pollTimer = setInterval(() => void fetchScan(), 2000);
	}

	function stopPolling() {
		if (pollTimer) {
			clearInterval(pollTimer);
			pollTimer = null;
		}
	}

	async function startScan() {
		scanStarting = true;
		try {
			const res = await fetch('/api/admin/medias/scan', { method: 'POST' });
			if (!res.ok) {
				throw new Error(await res.text().catch(() => res.statusText));
			}
			await fetchScan();
			startPolling();
		} catch (e: unknown) {
			toast.error(m.med_load_fail({ error: errorText(e) }));
		} finally {
			scanStarting = false;
		}
	}

	function formatDate(ms: number): string {
		return new Date(ms).toLocaleString('fr-FR');
	}

	// onMount, not $effect: this is one-shot setup, and an effect here would be a
	// standing invitation to re-run it the day someone reads a rune above.
	onMount(() => {
		void loadInventory();
		void fetchScan().then(() => {
			if (scan?.status === 'running') {
				// A scan started before this page was opened keeps reporting progress.
				startPolling();
			}
		});
		return stopPolling;
	});
</script>

<AdminPage
	title={m.med_title()}
	subtitle={m.med_subtitle()}
	icon={Images}
	maxWidth="1100px"
>
	{#snippet actions()}
		<button onclick={() => void loadInventory()} disabled={inventoryLoading}>
			<RefreshCw size={16} /> {m.med_reload()}
		</button>
	{/snippet}

	<section class="card">
		<h2><Images size={18} /> {m.med_inventory_title()}</h2>
		<p class="hint">{m.med_inventory_desc()}</p>

		{#if inventoryError}
			<p class="error">{m.med_load_fail({ error: inventoryError })}</p>
		{:else if !inventory}
			<p class="loading">...</p>
		{:else}
			<div class="stat-row">
				<div class="stat">
					<span class="stat-value">{inventory.immichAlbums}</span>
					<span class="stat-label">{m.med_inventory_immich()}</span>
				</div>
				<div class="stat">
					<span class="stat-value">{inventory.trackedAlbums}</span>
					<span class="stat-label">{m.med_inventory_tracked()}</span>
				</div>
			</div>

			{#if inventory.untracked.length === 0 && inventory.ghosts.length === 0}
				<p class="ok-line">{m.med_inventory_ok()}</p>
			{/if}

			{#if inventory.untracked.length > 0}
				<h3>{m.med_inventory_untracked()} ({inventory.untracked.length})</h3>
				<p class="hint">{m.med_inventory_untracked_desc()}</p>
				<ul class="plain-list">
					{#each inventory.untracked as album (album.id)}
						<li><strong>{album.name}</strong> <small>{album.assetCount}</small></li>
					{/each}
				</ul>
			{/if}

			{#if inventory.ghosts.length > 0}
				<h3>{m.med_inventory_ghosts()} ({inventory.ghosts.length})</h3>
				<p class="hint">{m.med_inventory_ghosts_desc()}</p>
				<ul class="plain-list">
					{#each inventory.ghosts as ghost (ghost.id)}
						<li><strong>{ghost.name}</strong> <small>{ghost.id}</small></li>
					{/each}
				</ul>
			{/if}
		{/if}
	</section>

	<section class="card">
		<h2><ImageOff size={18} /> {m.med_orphans_title()}</h2>
		<p class="hint">{m.med_orphans_desc()}</p>

		{#if !orphansLoaded && !orphansLoading}
			<button class="primary" onclick={() => void loadOrphans()}>
				<ImageOff size={16} /> {m.med_orphans_load()}
			</button>
		{/if}

		{#if orphansLoading}
			<p class="loading">{m.med_orphans_loading({ loaded: orphans.length })}</p>
		{/if}

		{#if orphansError}
			<p class="error">{m.med_load_fail({ error: orphansError })}</p>
		{/if}

		{#if orphansLoaded && !orphansLoading}
			{#if orphans.length === 0}
				<EmptyState icon={ImageOff} title={m.med_orphans_none()} size="sm" />
			{:else}
				<p class="count-line">{m.med_orphans_total({ count: orphans.length })}</p>

				<div class="toolbar">
					<button onclick={selectPage}>{m.med_orphans_select_page()}</button>
					<button onclick={selectAll}>
						{m.med_orphans_select_all({ count: orphans.length })}
					</button>
					<button onclick={() => selected.clear()} disabled={selected.size === 0}>
						{m.med_orphans_clear()}
					</button>
					<span class="spacer"></span>
					<strong>{m.med_orphans_selected({ count: selected.size })}</strong>
					<button
						class="primary"
						disabled={selected.size === 0 || acting}
						onclick={() => void openPicker()}
					>
						<FolderPlus size={16} /> {m.med_orphans_add()}
					</button>
					<button
						class="bg-red-600 text-white"
						disabled={selected.size === 0 || acting}
						onclick={() => void trashSelected()}
					>
						<Trash2 size={16} /> {m.med_orphans_trash()}
					</button>
				</div>

				{#if pickerOpen}
					<div class="picker">
						<div class="picker-head">
							<strong>{m.med_album_pick_title()}</strong>
							<button onclick={() => (pickerOpen = false)}>x</button>
						</div>
						<input
							type="text"
							bind:value={pickerQuery}
							placeholder={m.med_album_pick_search()}
						/>
						<ul class="picker-list">
							{#each pickerAlbums as album (album.id)}
								<li>
									<button onclick={() => void addToAlbum(album)}>
										{album.albumName}
										{#if album.date}<small>{album.date}</small>{/if}
									</button>
								</li>
							{/each}
							{#if pickerAlbums.length === 0}
								<li class="picker-empty">{m.med_album_pick_empty()}</li>
							{/if}
						</ul>
					</div>
				{/if}

				<div class="grid">
					{#each view as asset (asset.id)}
						<label class="tile" class:picked={selected.has(asset.id)}>
							<input
								type="checkbox"
								checked={selected.has(asset.id)}
								onchange={() => toggle(asset.id)}
							/>
							<img
								src={`/api/immich/assets/${asset.id}/thumbnail?size=thumbnail`}
								alt={asset.fileName}
								loading="lazy"
							/>
							<span class="tile-name">
								{#if asset.type === 'VIDEO'}<Film size={12} />{/if}
								{asset.fileName}
							</span>
						</label>
					{/each}
				</div>

				<div class="pager">
					<button disabled={viewStart === 0} onclick={() => (viewStart = Math.max(0, viewStart - VIEW_SIZE))}>
						&larr;
					</button>
					<span>
						{m.med_orphans_range({
							from: orphans.length === 0 ? 0 : viewStart + 1,
							to: Math.min(viewStart + VIEW_SIZE, orphans.length),
							total: orphans.length
						})}
					</span>
					<button
						disabled={viewStart + VIEW_SIZE >= orphans.length}
						onclick={() => (viewStart = viewStart + VIEW_SIZE)}
					>
						&rarr;
					</button>
				</div>
			{/if}
		{/if}
	</section>

	<section class="card">
		<h2><Layers size={18} /> {m.med_scan_title()}</h2>
		<p class="hint">{m.med_scan_desc()}</p>
		<p class="readonly-note"><AlertCircle size={14} /> {m.med_scan_readonly()}</p>

		{#if scanRunning}
			<p class="loading">
				{m.med_scan_running({
					done: scan?.albumsDone ?? 0,
					total: scan?.albumsTotal ?? 0,
					requests: scan?.requests ?? 0
				})}
			</p>
			<div class="progress">
				<div
					class="progress-fill"
					style="width: {scan?.albumsTotal
						? Math.round(((scan.albumsDone ?? 0) / scan.albumsTotal) * 100)
						: 0}%"
				></div>
			</div>
		{:else}
			<button class="primary" disabled={scanStarting} onclick={() => void startScan()}>
				<ScanSearch size={16} />
				{scan?.result ? m.med_scan_restart() : m.med_scan_start()}
			</button>
		{/if}

		{#if scan?.status === 'error' && scan.error}
			<p class="error">{m.med_scan_error({ error: scan.error })}</p>
		{/if}

		{#if scan?.result}
			{@const result = scan.result}
			<p class="count-line">
				{m.med_scan_last({
					date: formatDate(result.scannedAt),
					albums: result.albumsScanned,
					assets: result.assetsSeen
				})}
			</p>
			{#if result.albumsFailed.length > 0}
				<p class="warn-line">{m.med_scan_failed({ count: result.albumsFailed.length })}</p>
			{/if}
			{#if result.truncated}
				<p class="warn-line">{m.med_scan_truncated()}</p>
			{/if}

			{#if result.multiAlbum.length === 0}
				<EmptyState icon={Layers} title={m.med_scan_none()} size="sm" />
			{:else}
				<p class="count-line">{m.med_scan_result({ count: result.multiAlbum.length })}</p>
				{#if result.multiAlbum.length > TABLE_LIMIT}
					<p class="hint">
						{m.med_scan_shown({ shown: TABLE_LIMIT, total: result.multiAlbum.length })}
					</p>
				{/if}
				<div class="table-wrap">
					<table>
						<thead>
							<tr>
								<th></th>
								<th>{m.med_col_file()}</th>
								<th>{m.med_col_albums()}</th>
							</tr>
						</thead>
						<tbody>
							{#each result.multiAlbum.slice(0, TABLE_LIMIT) as asset (asset.id)}
								<tr>
									<td>
										<img
											class="row-thumb"
											src={`/api/immich/assets/${asset.id}/thumbnail?size=thumbnail`}
											alt={asset.fileName}
											loading="lazy"
										/>
									</td>
									<td>{asset.fileName}</td>
									<td>
										{#each asset.albums as album (album.id)}
											<a class="album-chip" href={`/albums/${album.id}`}>{album.name}</a>
										{/each}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		{:else if !scanRunning}
			<p class="hint">{m.med_scan_never()}</p>
		{/if}
	</section>
</AdminPage>

<style>
	h2 {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.stat-row {
		display: flex;
		gap: 1.5rem;
		flex-wrap: wrap;
		margin: 1rem 0;
	}

	.stat {
		display: flex;
		flex-direction: column;
		background: var(--bg-tertiary);
		border-radius: var(--radius-sm);
		padding: 0.75rem 1.25rem;
		min-width: 9rem;
	}

	.stat-value {
		font-size: 1.5rem;
		font-weight: 700;
		color: var(--accent);
	}

	.stat-label {
		font-size: 0.8125rem;
		color: var(--text-secondary);
	}

	.plain-list {
		list-style: none;
		padding: 0;
		margin: 0.5rem 0 0;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.plain-list li {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		background: var(--bg-tertiary);
		border-radius: var(--radius-sm);
		padding: 0.5rem 0.75rem;
	}

	.plain-list small {
		color: var(--text-muted);
	}

	.ok-line {
		color: var(--success);
	}

	.count-line {
		font-weight: 600;
	}

	.warn-line {
		color: var(--warning);
	}

	.readonly-note {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		color: var(--text-muted);
		font-size: 0.875rem;
	}

	.toolbar {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
		margin: 0.75rem 0;
	}

	.spacer {
		flex: 1;
	}

	.picker {
		background: var(--bg-tertiary);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		padding: 0.75rem;
		margin-bottom: 1rem;
	}

	.picker-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.5rem;
	}

	.picker-list {
		list-style: none;
		padding: 0;
		margin: 0.5rem 0 0;
		max-height: 16rem;
		overflow-y: auto;
	}

	.picker-list li button {
		width: 100%;
		text-align: left;
		display: flex;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.picker-empty {
		color: var(--text-muted);
		padding: 0.5rem;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
		gap: 0.5rem;
		margin: 0.75rem 0;
	}

	.tile {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		background: var(--bg-tertiary);
		border: 2px solid transparent;
		border-radius: var(--radius-sm);
		padding: 0.35rem;
		cursor: pointer;
	}

	.tile.picked {
		border-color: var(--accent);
	}

	.tile input[type='checkbox'] {
		position: absolute;
		top: 0.5rem;
		left: 0.5rem;
		z-index: 1;
	}

	.tile img {
		width: 100%;
		aspect-ratio: 1;
		object-fit: cover;
		border-radius: var(--radius-sm);
		background: var(--bg-secondary);
	}

	.tile-name {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.6875rem;
		color: var(--text-secondary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.pager {
		display: flex;
		align-items: center;
		gap: 1rem;
		justify-content: center;
	}

	.progress {
		height: 0.5rem;
		background: var(--bg-tertiary);
		border-radius: var(--radius-sm);
		overflow: hidden;
		margin: 0.5rem 0 1rem;
	}

	.progress-fill {
		height: 100%;
		background: var(--accent);
		transition: width 0.3s var(--ease);
	}

	.row-thumb {
		width: 3rem;
		height: 3rem;
		object-fit: cover;
		border-radius: var(--radius-sm);
	}

	.album-chip {
		display: inline-block;
		background: var(--bg-tertiary);
		border-radius: var(--radius-sm);
		padding: 0.15rem 0.5rem;
		margin: 0.1rem 0.2rem 0.1rem 0;
		font-size: 0.8125rem;
		color: var(--text-primary);
		text-decoration: none;
	}

	.album-chip:hover {
		color: var(--accent);
	}
</style>
