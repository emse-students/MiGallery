<script lang="ts">
	import { onMount } from 'svelte';
	import { RefreshCw, Activity, Cpu } from 'lucide-svelte';
	import AdminPage from '$lib/components/AdminPage.svelte';

	interface Metrics {
		timestamp: number;
		process: {
			uptimeSeconds: number;
			pid: number;
			nodeVersion: string;
			memory: {
				rss: number;
				heapTotal: number;
				heapUsed: number;
				external: number;
				arrayBuffers: number;
			};
		};
	}

	let metrics = $state<Metrics | null>(null);
	let error = $state<string | null>(null);
	let loading = $state(false);
	let autoRefresh = $state(true);

	async function load() {
		loading = true;
		try {
			const res = await fetch('/api/admin/metrics');
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			metrics = (await res.json()) as Metrics;
			error = null;
		} catch (e) {
			error = (e as Error).message;
		} finally {
			loading = false;
		}
	}

	function formatBytes(n: number): string {
		if (n < 1024) return `${n} o`;
		const units = ['Ko', 'Mo', 'Go'];
		let v = n / 1024;
		let i = 0;
		while (v >= 1024 && i < units.length - 1) {
			v /= 1024;
			i++;
		}
		return `${v.toFixed(1)} ${units[i]}`;
	}

	function formatUptime(s: number): string {
		const d = Math.floor(s / 86400);
		const h = Math.floor((s % 86400) / 3600);
		const m = Math.floor((s % 3600) / 60);
		const sec = s % 60;
		if (d > 0) return `${d}j ${h}h ${m}m`;
		if (h > 0) return `${h}h ${m}m ${sec}s`;
		if (m > 0) return `${m}m ${sec}s`;
		return `${sec}s`;
	}

	// Poll while auto-refresh is on; the effect cleanup clears the interval when
	// it is toggled off or the component is destroyed.
	$effect(() => {
		if (!autoRefresh) return;
		const t = setInterval(load, 5000);
		return () => clearInterval(t);
	});

	onMount(load);
</script>

<svelte:head>
	<title>Admin - Santé</title>
</svelte:head>

<AdminPage
	title="Santé du serveur"
	subtitle="Mémoire du process et uptime (temps réel)"
	icon={Activity}
	maxWidth="1100px"
>
	{#snippet actions()}
		<label class="auto-toggle">
			<input type="checkbox" bind:checked={autoRefresh} />
			<span>Auto (5s)</span>
		</label>
		<button type="button" class="btn-glass icon" onclick={load} disabled={loading} title="Rafraichir">
			<RefreshCw size={18} class={loading ? 'spin' : ''} />
		</button>
	{/snippet}

	{#if error}
		<div class="error-box">Erreur de chargement : {error}</div>
	{/if}

	{#if metrics}
		<div class="cards">
			<section class="card">
				<div class="card-head">
					<Cpu size={18} />
					<h2>Process</h2>
				</div>
				<dl class="kv">
					<div><dt>Uptime</dt><dd>{formatUptime(metrics.process.uptimeSeconds)}</dd></div>
					<div><dt>Node</dt><dd>{metrics.process.nodeVersion}</dd></div>
					<div><dt>PID</dt><dd>{metrics.process.pid}</dd></div>
				</dl>
			</section>

			<section class="card">
				<div class="card-head">
					<Activity size={18} />
					<h2>Mémoire</h2>
				</div>
				<dl class="kv">
					<div><dt>RSS</dt><dd class="strong">{formatBytes(metrics.process.memory.rss)}</dd></div>
					<div><dt>Heap utilisé</dt><dd>{formatBytes(metrics.process.memory.heapUsed)}</dd></div>
					<div><dt>Heap total</dt><dd>{formatBytes(metrics.process.memory.heapTotal)}</dd></div>
					<div><dt>External</dt><dd>{formatBytes(metrics.process.memory.external)}</dd></div>
					<div>
						<dt>ArrayBuffers</dt>
						<dd>{formatBytes(metrics.process.memory.arrayBuffers)}</dd>
					</div>
				</dl>
			</section>
		</div>

		<p class="updated">
			Dernière mise à jour : {new Date(metrics.timestamp).toLocaleTimeString('fr-FR')}
		</p>
	{:else if !error}
		<p class="loading-hint">Chargement des métriques…</p>
	{/if}
</AdminPage>

<style>
	.auto-toggle {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.85rem;
		color: var(--text-secondary);
		cursor: pointer;
		user-select: none;
	}

	.cards {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
		gap: 1.5rem;
	}

	.card {
		background: var(--glass-bg, var(--bg-secondary));
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1.5rem;
		backdrop-filter: blur(12px);
	}
	.card-head {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 1rem;
		padding-bottom: 0.75rem;
		border-bottom: 1px solid var(--border);
		color: var(--text-secondary);
	}
	.card-head h2 {
		font-size: 1rem;
		font-weight: 700;
		margin: 0;
		color: var(--text-primary);
	}

	.kv {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.kv > div {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 1rem;
	}
	.kv dt {
		color: var(--text-secondary);
		font-size: 0.9rem;
	}
	.kv dd {
		margin: 0;
		font-variant-numeric: tabular-nums;
		font-weight: 500;
		color: var(--text-primary);
	}
	.kv dd.strong {
		font-weight: 700;
		font-size: 1.05rem;
	}

	.error-box {
		background: color-mix(in srgb, var(--error) 10%, transparent);
		border: 1px solid color-mix(in srgb, var(--error) 30%, transparent);
		color: var(--error);
		padding: 0.75rem 1rem;
		border-radius: var(--radius-sm);
		margin-bottom: 1.5rem;
	}
	.updated {
		margin-top: 1.5rem;
		color: var(--text-muted);
		font-size: 0.8rem;
		text-align: right;
	}
	.loading-hint {
		color: var(--text-muted);
	}

	:global(.admin-page .spin) {
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
