<script lang="ts">
	import { page } from '$app/state';
	import { BookOpen, List, FileText } from 'lucide-svelte';
	import { m } from '$lib/paraglide/messages';
	import AdminPage from '$lib/components/AdminPage.svelte';

	interface Doc {
		filename: string;
		title: string;
		content: string;
		name: string;
		html: string;
	}

	// Server (+page.server.ts) already returns docs in the intended order
	// (index, then API reference, then alphabetical).
	const docs = (page.data as { docs?: Doc[] }).docs || [];

	function scrollToDoc(id: string) {
		const el = document.getElementById(id);
		if (el) {
			const offset = window.innerWidth < 1024 ? 20 : 100;
			const y = el.getBoundingClientRect().top + window.scrollY - offset;
			window.scrollTo({ top: y, behavior: 'smooth' });
		}
	}
</script>

<svelte:head>
	<title>{m.doc_page_title()}</title>
</svelte:head>

<AdminPage
	title={m.doc_title()}
	subtitle={m.doc_subtitle()}
	icon={BookOpen}
	maxWidth="1400px"
>
		<div class="docs-layout">
			<!-- SIDEBAR (TOC) -->
			<aside class="docs-sidebar">
				<div class="sidebar-content">
					<div class="sidebar-header">
						<List size={18} />
						<span>{m.doc_toc()}</span>
					</div>
					<nav>
						<ul>
							{#each docs as d}
								<li>
									<button onclick={() => scrollToDoc(d.filename)} class="toc-link">
										<span class="doc-icon"><FileText size={14} /></span>
										<span class="doc-name">{d.name}</span>
									</button>
								</li>
							{/each}
						</ul>
					</nav>
				</div>
			</aside>

			<!-- CONTENT -->
			<div class="docs-content">
				{#each docs as d}
					<article id={d.filename} class="doc-card">
						<header class="doc-header">
							<div class="title-row">
								<h2>{d.name}</h2>
								<span class="filename-badge">{d.filename}</span>
							</div>
						</header>

						<div class="doc-body">
							{@html d.html}
						</div>
					</article>
				{/each}
			</div>
		</div>
</AdminPage>

<style>
	/* --- LOCAL SURFACE TOKENS (non-mirror: card + code block) --- */
	.docs-layout {
		--doc-card-bg: rgba(255, 255, 255, 0.8);
		--doc-code-bg: #1e293b;
		--doc-code-text: #e2e8f0;

		display: grid;
		grid-template-columns: 280px 1fr;
		gap: 2rem;
		align-items: start;
	}

	:global([data-theme='dark']) .docs-layout {
		--doc-card-bg: rgba(30, 41, 59, 0.7);
		--doc-code-bg: #020617;
	}

	/* --- SIDEBAR --- */
	.docs-sidebar {
		position: sticky;
		top: 2rem;
		height: auto;
	}

	.sidebar-content {
		background: var(--doc-card-bg);
		backdrop-filter: blur(12px);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1.5rem;
		max-height: calc(100vh - 4rem);
		overflow-y: auto;
		scrollbar-width: thin;
		scrollbar-color: var(--border) transparent;
	}

	.sidebar-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-weight: 700;
		color: var(--text-secondary);
		text-transform: uppercase;
		font-size: 0.8rem;
		letter-spacing: 0.05em;
		margin-bottom: 1rem;
		padding-bottom: 0.75rem;
		border-bottom: 1px solid var(--border);
	}

	.toc-link {
		display: flex;
		align-items: flex-start; /* Top alignment for multiline text */
		gap: 0.75rem;
		width: 100%;
		text-align: left;
		padding: 0.6rem 0.75rem;
		border: none;
		background: transparent;
		color: var(--text-primary);
		border-radius: var(--radius-xs);
		cursor: pointer;
		transition: all 0.2s;
		font-size: 0.9rem;

		/* Handling line wrapping */
		white-space: normal; /* Allows line wrapping */
		overflow-wrap: break-word; /* Break long words if needed */
		word-break: break-word;
		line-height: 1.4;
	}

	.toc-link:hover {
		background: color-mix(in srgb, var(--accent) 10%, transparent);
		color: var(--accent);
	}

	.doc-icon {
		color: var(--text-secondary);
		opacity: 0.7;
		min-width: 16px; /* Espace fixe pour l'icône */
		margin-top: 2px; /* Optical alignment with first line of text */
	}
	.toc-link:hover .doc-icon {
		color: var(--accent);
		opacity: 1;
	}

	/* --- DOC CONTENT --- */
	.docs-content {
		display: flex;
		flex-direction: column;
		gap: 3rem;
		min-width: 0;
	}

	.doc-card {
		background: var(--doc-card-bg);
		backdrop-filter: blur(16px);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 2.5rem;
		box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.02);
		overflow: hidden;
	}

	.doc-header {
		margin-bottom: 2rem;
		padding-bottom: 1.5rem;
		border-bottom: 1px solid var(--border);
	}

	.title-row {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.doc-header h2 {
		font-size: 1.75rem;
		font-weight: 800;
		margin: 0;
		color: var(--text-primary);
		word-break: break-word;
		line-height: 1.3;
	}

	.filename-badge {
		font-family: monospace;
		font-size: 0.8rem;
		background: color-mix(in srgb, var(--text-primary) 5%, transparent);
		color: var(--text-secondary);
		padding: 0.25rem 0.5rem;
		border-radius: 6px;
		border: 1px solid var(--border);
		word-break: break-all; /* Force breaking of long filenames */
		max-width: 100%; /* Prevent overflow */
	}

	/* --- MARKDOWN STYLES --- */

	:global(.doc-body) {
		color: var(--text-primary);
		line-height: 1.7;
		font-size: 1rem;
		overflow-wrap: break-word;
	}

	:global(.doc-body h1),
	:global(.doc-body h2),
	:global(.doc-body h3) {
		color: var(--text-primary);
		font-weight: 700;
		margin-top: 2rem;
		margin-bottom: 1rem;
		line-height: 1.3;
	}

	:global(.doc-body h1) {
		font-size: 1.5rem;
		border-bottom: 1px solid var(--border);
		padding-bottom: 0.5rem;
	}
	:global(.doc-body h2) {
		font-size: 1.3rem;
	}
	:global(.doc-body h3) {
		font-size: 1.1rem;
	}

	:global(.doc-body p) {
		margin-bottom: 1.2rem;
	}

	:global(.doc-body ul),
	:global(.doc-body ol) {
		margin-bottom: 1.5rem;
		padding-left: 1.5rem;
	}

	:global(.doc-body li) {
		margin-bottom: 0.5rem;
	}

	:global(.doc-body pre) {
		background: var(--doc-code-bg);
		color: var(--doc-code-text);
		padding: 1.25rem;
		border-radius: var(--radius-md);
		overflow-x: auto;
		margin: 1.5rem 0;
		border: 1px solid rgba(255, 255, 255, 0.1);
		font-family: 'Fira Code', monospace;
		font-size: 0.9rem;
		max-width: 100%;
	}

	:global(.doc-body code) {
		background: color-mix(in srgb, var(--accent) 10%, transparent);
		color: var(--accent);
		padding: 0.2rem 0.4rem;
		border-radius: 4px;
		font-family: monospace;
		font-size: 0.9em;
		word-break: break-word;
	}

	:global(.doc-body pre code) {
		background: transparent;
		color: inherit;
		padding: 0;
		word-break: normal;
	}

	:global(.doc-body a) {
		color: var(--accent);
		text-decoration: none;
		font-weight: 500;
		border-bottom: 1px dashed var(--accent);
		word-break: break-all;
	}
	:global(.doc-body a:hover) {
		border-bottom-style: solid;
	}

	:global(.doc-body table) {
		width: 100%;
		border-collapse: collapse;
		margin: 1.5rem 0;
		font-size: 0.95rem;
		display: block;
		overflow-x: auto;
	}
	:global(.doc-body th) {
		text-align: left;
		padding: 0.75rem;
		background: color-mix(in srgb, var(--text-primary) 5%, transparent);
		border-bottom: 2px solid var(--border);
		font-weight: 600;
		white-space: nowrap;
	}
	:global(.doc-body td) {
		padding: 0.75rem;
		border-bottom: 1px solid var(--border);
		min-width: 120px;
	}

	/* --- RESPONSIVE --- */
	@media (max-width: 1024px) {
		.docs-layout {
			grid-template-columns: 1fr;
			gap: 2rem;
		}

		.docs-sidebar {
			position: relative;
			top: 0;
			margin-bottom: 1rem;
			z-index: 2;
		}

		.sidebar-content {
			max-height: 300px;
		}

		.doc-card {
			padding: 1.5rem;
		}
	}
</style>
