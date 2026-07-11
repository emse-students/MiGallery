<script lang="ts">
	import {
		Database,
		ChartColumn,
		Zap,
		Save,
		Download,
		Activity,
		Wrench,
		AlertTriangle,
		CloudUpload,
		CheckCircle,
		XCircle,
		Archive,
		Inbox,
		FileText,
		RotateCcw,
		Box
	} from 'lucide-svelte';
	import AdminPage from '$lib/components/AdminPage.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import { page } from '$app/state';
	import type { PageData } from './$types';
	import { asApiResponse } from '$lib/ts-utils';
	import { showConfirm } from '$lib/confirm';
	import { toast } from '$lib/toast';
	import { m } from '$lib/paraglide/messages';

	let isAdmin = $derived(page.data.session?.user?.role === 'admin');
	const data = page.data as PageData;
	const stats = data.stats;
	const backups = data.backups || [];

	let uploadFile = $state<File | null>(null);
	let importing = $state(false);
	let exporting = $state(false);
	let backing = $state(false);
	let inspecting = $state(false);
	let repairing = $state(false);
	let databaseStatus = $state<any>(null);
	let showRepairModal = $state(false);

	let persistentMessage = $state('');
	let persistentMessageType: 'success' | 'error' | 'info' = 'info';

	function handleFileSelect(event: Event) {
		const input = event.target as HTMLInputElement;
		if (input.files && input.files.length > 0) {
			uploadFile = input.files[0];
		}
	}

	async function exportDatabase() {
		exporting = true;
		try {
			const response = await fetch('/api/admin/db-export');
			if (!response.ok) throw new Error(m.db_export_fail());

			const blob = await response.blob();
			const url = window.URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `migallery_export_${new Date().toISOString().split('T')[0]}.db`;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			window.URL.revokeObjectURL(url);

			toast.success(m.db_export_success());
		} catch (error: unknown) {
			toast.error(m.db_export_error({ error: String(error) }));
		} finally {
			exporting = false;
		}
	}

	async function importDatabase() {
		if (!uploadFile) {
			toast.error(m.db_select_file());
			return;
		}

		const ok = await showConfirm(m.db_import_confirm(), m.db_import_title());
		if (!ok) return;

		importing = true;
		try {
			const formData = new FormData();
			formData.append('file', uploadFile);

			const response = await fetch('/api/admin/db-import', {
				method: 'POST',
				body: formData
			});

			const jsonData = await response.json();
			const result = asApiResponse(jsonData);

			if (!response.ok) throw new Error(result.error || m.db_import_fail());

			toast.success(m.db_import_success());
			setTimeout(() => window.location.reload(), 2000);
		} catch (error: unknown) {
			toast.error(m.db_import_error({ error: String(error) }));
		} finally {
			importing = false;
		}
	}

	async function createBackup() {
		backing = true;
		try {
			const response = await fetch('/api/admin/db-backup', { method: 'POST' });
			const jsonData = await response.json();
			const result = asApiResponse(jsonData);

			if (!response.ok) throw new Error(result.error || m.db_backup_fail());

			toast.success(result.message || m.db_backup_success());
			setTimeout(() => window.location.reload(), 1500);
		} catch (error: unknown) {
			toast.error(m.db_backup_error({ error: String(error) }));
		} finally {
			backing = false;
		}
	}

	async function inspectDatabase() {
		inspecting = true;
		persistentMessage = '';
		try {
			const response = await fetch('/admin/api/database');
			const result = await response.json();

			if (result.success) {
				databaseStatus = result;
				if (result.status === 'healthy') {
					toast.success(m.db_healthy_toast());
				} else {
					toast.error(m.db_incomplete_toast({ count: result.missingTables?.length || 0 }));
				}
			} else {
				toast.error(m.db_inspect_error({ error: String(result.error) }));
			}
		} catch (error: unknown) {
			toast.error(m.db_inspect_error({ error: String(error) }));
		} finally {
			inspecting = false;
		}
	}

	async function repairDatabase() {
		repairing = true;
		showRepairModal = false;
		try {
			const response = await fetch('/admin/api/database', { method: 'POST' });
			const result = await response.json();

			if (result.success) {
				toast.success(m.db_repair_success());
				databaseStatus = result.newStatus;
				setTimeout(() => inspectDatabase(), 1000);
			} else {
				toast.error(m.db_repair_error({ error: String(result.error) }));
			}
		} catch (error: unknown) {
			toast.error(m.common_error_detail({ error: String(error) }));
		} finally {
			repairing = false;
		}
	}

	async function restoreBackup(filename: string) {
		const ok = await showConfirm(m.db_restore_confirm({ filename }), m.db_restore_title());
		if (!ok) return;

		try {
			const response = await fetch('/api/admin/db-restore', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ filename })
			});

			const jsonData = await response.json();
			const result = asApiResponse(jsonData);

			if (!response.ok) throw new Error(result.error || m.db_restore_fail());

			toast.success(m.db_restore_success());
			setTimeout(() => window.location.reload(), 2000);
		} catch (error: unknown) {
			toast.error(m.db_restore_error({ error: String(error) }));
		}
	}
</script>

<svelte:head>
	<title>{m.db_page_title()}</title>
</svelte:head>

<AdminPage
	title={m.db_title()}
	subtitle={m.db_subtitle()}
	icon={Database}
	maxWidth="1200px"
>
		{#if persistentMessage}
			<div
				class="glass-card mb-6 border-l-4"
				class:border-red-500={(persistentMessageType as any) === 'error'}
				class:border-green-500={(persistentMessageType as any) !== 'error'}
			>
				{persistentMessage}
			</div>
		{/if}

		<div class="dashboard-grid">
			<!-- Left column: Stats & Actions -->
			<div class="left-col">
				<!-- Statistiques -->
				<section class="glass-card">
					<h2 class="section-title"><ChartColumn size={20} /> {m.db_stats()}</h2>
					<div class="stats-grid">
						<div class="stat-item">
							<span class="stat-label">{m.db_stat_users()}</span>
							<span class="stat-value">{stats.users}</span>
						</div>
						<div class="stat-item">
							<span class="stat-label">{m.db_stat_albums()}</span>
							<span class="stat-value">{stats.albums}</span>
						</div>
						<div class="stat-item">
							<span class="stat-label">{m.db_stat_admins()}</span>
							<span class="stat-value">{stats.admins}</span>
						</div>
						<div class="stat-item">
							<span class="stat-label">{m.db_stat_size()}</span>
							<span class="stat-value highlight">{stats.size}</span>
						</div>
					</div>
				</section>

				<!-- Quick Actions -->
				<section class="glass-card">
					<h2 class="section-title"><Zap size={20} /> {m.db_quick_actions()}</h2>
					<div class="actions-list">
						<button type="button" class="action-btn primary" onclick={createBackup} disabled={backing}>
							<div class="btn-icon-wrapper"><Save size={24} /></div>
							<div class="btn-content">
								<span class="btn-title">{m.db_backup_btn()}</span>
								<span class="btn-desc">{backing ? m.db_in_progress() : m.db_backup_desc()}</span>
							</div>
						</button>

						<button type="button" class="action-btn secondary" onclick={exportDatabase} disabled={exporting}>
							<div class="btn-icon-wrapper"><Download size={24} /></div>
							<div class="btn-content">
								<span class="btn-title">{m.db_export_btn()}</span>
								<span class="btn-desc">{exporting ? m.db_in_progress() : m.db_export_desc()}</span>
							</div>
						</button>

						<button type="button" class="action-btn info" onclick={inspectDatabase} disabled={inspecting}>
							<div class="btn-icon-wrapper"><Activity size={24} /></div>
							<div class="btn-content">
								<span class="btn-title">{m.db_inspect_btn()}</span>
								<span class="btn-desc">{inspecting ? m.db_analyzing() : m.db_inspect_desc()}</span>
							</div>
						</button>

						{#if databaseStatus && databaseStatus.status !== 'healthy'}
							<button
								type="button"
								class="action-btn warning"
								onclick={() => (showRepairModal = true)}
								disabled={repairing}
							>
								<div class="btn-icon-wrapper"><Wrench size={24} /></div>
								<div class="btn-content">
									<span class="btn-title">{m.db_repair_btn()}</span>
									<span class="btn-desc">{m.db_missing_tables()}</span>
								</div>
							</button>
						{/if}
					</div>
				</section>

				<!-- Import (Danger Zone) -->
				<section class="glass-card danger-zone">
					<h2 class="section-title text-red-500"><AlertTriangle size={20} /> {m.db_danger_zone()}</h2>
					<p class="text-sm text-muted mb-4">
						{m.db_danger_note()}
					</p>

					<div class="file-drop-area">
						<input
							type="file"
							id="db_upload"
							accept=".db"
							onchange={handleFileSelect}
							disabled={importing}
						/>
						<label for="db_upload">
							<CloudUpload size={32} class="mb-2 text-muted" />
							<span class="font-medium">{uploadFile ? uploadFile.name : m.db_choose_file()}</span>
						</label>
					</div>

					<button
						type="button"
						class="btn-glass danger btn-full-danger mt-4"
						onclick={importDatabase}
						disabled={importing || !uploadFile}
					>
						{importing ? m.db_importing() : m.db_import_btn()}
					</button>
				</section>
			</div>

			<!-- Right column: Status & Backups -->
			<div class="right-col">
				<!-- Detailed status (displayed after inspection) -->
				{#if databaseStatus}
					<section class="glass-card slide-in">
						<div class="flex items-center justify-between mb-4">
							<h2 class="section-title m-0">{m.db_system_state()}</h2>
							<span class="status-badge {databaseStatus.status}">
								{databaseStatus.status === 'healthy' ? m.db_status_healthy() : m.db_status_problem()}
							</span>
						</div>

						<div class="tables-grid">
							{#each databaseStatus.tables || [] as table}
								<div class="table-check-item {table.exists ? 'valid' : 'invalid'}">
									{#if table.exists}
										<CheckCircle size={16} />
									{:else}
										<XCircle size={16} />
									{/if}
									<span class="t-name">{table.name}</span>
									<span class="t-count">{table.rowCount ?? 0}</span>
								</div>
							{/each}
						</div>

						{#if databaseStatus.missingTables?.length > 0}
							<div class="mt-4 p-3 bg-red-500/10 rounded-lg border border-red-500/20">
								<strong class="text-red-500 text-sm block mb-1">{m.db_missing_label()}</strong>
								<div class="flex flex-wrap gap-2">
									{#each databaseStatus.missingTables as t}
										<span class="text-xs bg-red-500/20 text-red-600 px-2 py-1 rounded">{t}</span>
									{/each}
								</div>
							</div>
						{/if}
					</section>
				{/if}

				<!-- Backups -->
				<section class="glass-card">
					<div class="flex items-center justify-between mb-4">
						<h2 class="section-title m-0"><Archive size={20} /> {m.db_backups()}</h2>
					</div>

					<div class="backup-list-container">
						{#if backups.length === 0}
							<EmptyState icon={Inbox} title={m.db_no_backups()} />
						{:else}
							{#each backups as backup}
								<div class="backup-row">
									<div class="backup-icon">
										<FileText size={20} />
									</div>
									<div class="backup-details">
										<div class="backup-name">{backup.filename}</div>
										<div class="backup-meta">
											<span>{backup.size}</span>
										</div>
									</div>
									<button
										type="button"
										class="btn-restore"
										onclick={() => restoreBackup(backup.filename)}
										title={m.db_restore_title()}
									>
										<RotateCcw size={18} />
									</button>
								</div>
							{/each}
						{/if}
					</div>
				</section>
			</div>
		</div>

	<!-- Repair Modal -->
	{#if showRepairModal}
		<div class="modal-backdrop" onclick={() => (showRepairModal = false)} role="presentation">
			<div
				class="modal-glass"
				onclick={(e) => e.stopPropagation()}
				role="dialog"
				tabindex="0"
				aria-modal="true"
				aria-labelledby="repairDialogTitle"
				onkeydown={(e) => {
					if (e.key === 'Escape') showRepairModal = false;
					else e.stopPropagation();
				}}
			>
				<div class="modal-icon warning">
					<Wrench size={32} />
				</div>
				<h3 id="repairDialogTitle">{m.db_repair_modal_title()}</h3>
				<p>
					{m.db_repair_modal_body()}
				</p>
				<div class="modal-actions">
					<button type="button" class="btn-glass" onclick={() => (showRepairModal = false)}>{m.common_cancel()}</button>
					<button type="button" class="btn-glass primary" onclick={repairDatabase} disabled={repairing}>
						{repairing ? m.db_repairing() : m.db_repair_confirm_btn()}
					</button>
				</div>
			</div>
		</div>
	{/if}
</AdminPage>

<style>
	/* Uses the global theme tokens directly (no per-page mirror variables). */

	/* --- GRID LAYOUT --- */
	.dashboard-grid {
		display: grid;
		grid-template-columns: 2fr 1.2fr;
		gap: 2.5rem; /* Gap significantly increased */
		align-items: start;
	}
	@media (max-width: 900px) {
		.dashboard-grid {
			grid-template-columns: 1fr;
		}
	}

	.left-col,
	.right-col {
		display: flex;
		flex-direction: column;
		gap: 2rem; /* Vertical spacing between cards */
	}

	/* --- CARDS --- */
	.glass-card {
		background: var(--glass-bg);
		backdrop-filter: blur(20px);
		-webkit-backdrop-filter: blur(20px);
		border: 1px solid var(--glass-border);
		border-radius: var(--radius-lg);
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.05);
		padding: 2rem; /* Padding interne explicite */
	}

	/* Special case for backup card with custom header */
	.backup-card {
		padding: 0;
		overflow: hidden;
		display: flex;
		flex-direction: column;
		height: 100%;
		max-height: 800px;
	}
	.backup-header {
		padding: 1.5rem 2rem;
		border-bottom: 1px solid var(--border);
		display: flex;
		justify-content: space-between;
		align-items: center;
		background: rgba(255, 255, 255, 0.02);
	}
	.backup-list-container {
		overflow-y: auto;
		flex: 1;
		padding: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.section-title {
		font-size: 1.1rem;
		font-weight: 700;
		margin-bottom: 1.5rem;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		color: var(--text-primary);
	}
	.section-title.m-0 {
		margin-bottom: 0;
	}

	/* --- STATS --- */
	.stats-grid {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 1.25rem;
	}
	@media (max-width: 600px) {
		.stats-grid {
			grid-template-columns: repeat(2, 1fr);
		}
	}

	.stat-item {
		background: var(--glass-bg);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1.25rem 1rem;
		text-align: center;
		transition: transform 0.2s;
	}
	.stat-item:hover {
		transform: translateY(-2px);
		border-color: var(--glass-border);
	}
	.stat-label {
		display: block;
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--text-secondary);
		margin-bottom: 0.5rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.stat-value {
		font-size: 1.5rem;
		font-weight: 800;
		color: var(--text-primary);
	}
	.stat-value.highlight {
		background: var(--gradient-brand);
		background-clip: text;
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		color: transparent;
	}

	/* --- ACTIONS --- */
	.actions-list {
		display: grid;
		grid-template-columns: 1fr;
		gap: 1.25rem;
	}
	.action-btn {
		display: flex;
		align-items: center;
		gap: 1.25rem;
		width: 100%;
		padding: 1.25rem;
		border-radius: var(--radius);
		border: 1px solid transparent;
		background: var(--glass-bg);
		text-align: left;
		cursor: pointer;
		transition: all 0.2s;
	}
	.action-btn:hover:not(:disabled) {
		transform: translateY(-2px);
		background: var(--bg-tertiary);
		border-color: var(--glass-border);
		box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1);
	}
	.action-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
		filter: grayscale(1);
	}

	.btn-icon-wrapper {
		width: 48px;
		height: 48px;
		border-radius: var(--radius-md);
		display: flex;
		align-items: center;
		justify-content: center;
		color: white;
		flex-shrink: 0;
		box-shadow: 0 4px 10px rgba(0, 0, 0, 0.1);
	}

	.action-btn.primary .btn-icon-wrapper {
		background: var(--gradient-blue);
	}
	.action-btn.secondary .btn-icon-wrapper {
		background: var(--gradient-green);
	}
	.action-btn.info .btn-icon-wrapper {
		background: var(--gradient-edit);
	}
	.action-btn.warning .btn-icon-wrapper {
		background: linear-gradient(135deg, #f59e0b, #d97706);
	}

	.btn-content {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	.btn-title {
		font-weight: 700;
		font-size: 1rem;
		color: var(--text-primary);
	}
	.btn-desc {
		font-size: 0.85rem;
		color: var(--text-secondary);
	}

	/* --- DANGER ZONE / IMPORT --- */
	.danger-zone {
		border-color: color-mix(in srgb, var(--error) 20%, transparent);
		background: color-mix(in srgb, var(--error) 5%, transparent) !important;
	}
	:global([data-theme='dark']) .danger-zone {
		background: rgba(239, 68, 68, 0.1) !important;
	}

	.file-drop-area {
		position: relative;
		margin-top: 1rem;
	}
	.file-drop-area input {
		position: absolute;
		inset: 0;
		opacity: 0;
		cursor: pointer;
		z-index: 2;
	}
	.file-drop-area label {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 2.5rem;
		border: 2px dashed var(--border);
		border-radius: var(--radius);
		background: var(--glass-bg);
		transition: all 0.2s;
	}
	.file-drop-area input:hover + label {
		border-color: var(--accent);
		background: var(--bg-tertiary);
	}

	.btn-full-danger {
		width: 100%;
	}

	/* --- STATUS BADGES & TABLES --- */
	.status-badge {
		padding: 0.35rem 0.85rem;
		border-radius: 99px;
		font-size: 0.85rem;
		font-weight: 700;
	}
	.status-badge.healthy {
		background: color-mix(in srgb, var(--success) 20%, transparent);
		color: var(--success);
		border: 1px solid color-mix(in srgb, var(--success) 30%, transparent);
	}
	.status-badge.incomplete {
		background: rgba(234, 179, 8, 0.2);
		color: #eab308;
		border: 1px solid rgba(234, 179, 8, 0.3);
	}

	.tables-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
		gap: 0.75rem;
	}
	.table-check-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem;
		border-radius: var(--radius-xs);
		border: 1px solid var(--border);
		background: var(--glass-bg);
		font-size: 0.85rem;
	}
	.table-check-item.valid {
		color: var(--success);
		border-color: color-mix(in srgb, var(--success) 20%, transparent);
	}
	.table-check-item.invalid {
		color: var(--error);
		border-color: color-mix(in srgb, var(--error) 20%, transparent);
	}
	.t-name {
		flex: 1;
		font-weight: 500;
		color: var(--text-primary);
	}
	.t-count {
		font-family: monospace;
		color: var(--text-secondary);
		font-size: 0.75rem;
	}

	/* --- BACKUPS LIST --- */
	.backup-row {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 1rem;
		background: var(--glass-bg);
		border-radius: var(--radius-md);
		border: 1px solid transparent;
		transition: all 0.2s;
	}
	.backup-row:hover {
		background: var(--bg-tertiary);
		border-color: var(--glass-border);
	}

	.backup-icon {
		width: 40px;
		height: 40px;
		background: color-mix(in srgb, var(--accent) 10%, transparent);
		color: var(--accent);
		border-radius: var(--radius-sm);
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.backup-details {
		flex: 1;
	}
	.backup-name {
		font-weight: 600;
		font-size: 0.9rem;
		color: var(--text-primary);
	}
	.backup-meta {
		font-size: 0.75rem;
		color: var(--text-secondary);
		margin-top: 2px;
	}

	.btn-restore {
		width: 36px;
		height: 36px;
		padding: 0;
		border: none;
		background: transparent;
		color: var(--text-secondary);
		border-radius: var(--radius-xs);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.2s;
	}
	.btn-restore:hover {
		background: color-mix(in srgb, var(--accent) 15%, transparent);
		color: var(--accent);
	}

	/* --- MODAL --- */
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.55);
		backdrop-filter: blur(8px) saturate(120%);
		z-index: 100;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.modal-glass {
		background: rgba(255, 255, 255, 0.04);
		width: 90%;
		max-width: 520px;
		padding: 1.75rem;
		border-radius: 18px;
		border: 1px solid rgba(255, 255, 255, 0.06);
		box-shadow: 0 20px 50px rgba(2, 6, 23, 0.6);
		text-align: center;
		position: relative;
		overflow: hidden;
		backdrop-filter: blur(8px) saturate(120%);
	}
	/* Small glow effect in modal */
	.modal-glass::before {
		content: '';
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		height: 100px;
		background: linear-gradient(to bottom, rgba(255, 255, 255, 0.05), transparent);
		pointer-events: none;
	}

	.modal-icon.warning {
		width: 64px;
		height: 64px;
		background: rgba(245, 158, 11, 0.1);
		color: #f59e0b;
		border-radius: var(--radius-lg);
		display: flex;
		align-items: center;
		justify-content: center;
		margin: 0 auto 1.5rem;
	}
	.modal-glass h3 {
		font-size: 1.5rem;
		margin-bottom: 0.5rem;
		color: var(--text-primary);
	}
	.modal-glass p {
		color: var(--text-secondary);
		margin-bottom: 2rem;
		line-height: 1.6;
	}

	.modal-actions {
		display: flex;
		gap: 1rem;
		justify-content: center;
	}

	.slide-in {
		animation: slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
	}
	@keyframes slideIn {
		from {
			opacity: 0;
			transform: translateY(20px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
</style>
