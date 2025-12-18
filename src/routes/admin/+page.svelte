<script lang="ts">
  import { page } from '$app/state';
  import Icon from '$lib/components/Icon.svelte';
  import BackgroundBlobs from '$lib/components/BackgroundBlobs.svelte';

  interface Doc { filename: string; title: string; content: string; name: string; html: string; }

  const docsRaw = (page.data as { docs?: Doc[] }).docs || [];

  const docs = docsRaw.slice().sort((a, b) => {
    const an = a.filename.toLowerCase();
    const bn = b.filename.toLowerCase();
    if (an.includes('api_endpoints') || an.includes('api-endpoints')) return -1;
    if (bn.includes('api_endpoints') || bn.includes('api-endpoints')) return 1;
    return a.name.localeCompare(b.name);
  });

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
  <title>Admin — Documentation</title>
</svelte:head>

<main class="docs-main">
  <BackgroundBlobs />

  <div class="docs-container">
    <header class="page-header">
      <div class="header-icon">
        <Icon name="book-open" size={32} />
      </div>
      <div>
        <h1>Documentation interne</h1>
        <p class="subtitle">Référence technique et guides développeur</p>
      </div>
    </header>

    <div class="docs-layout">
      <!-- SIDEBAR (TOC) -->
      <aside class="docs-sidebar">
        <div class="sidebar-content">
            <div class="sidebar-header">
                <Icon name="list" size={18} />
                <span>Sommaire</span>
            </div>
            <nav>
                <ul>
                    {#each docs as d}
                    <li>
                        <button
                            onclick={() => scrollToDoc(d.filename)}
                            class="toc-link"
                        >
                            <span class="doc-icon"><Icon name="file-text" size={14} /></span>
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
  </div>
</main>

<style>
  /* --- THEME VARIABLES --- */
  .docs-main {
    --doc-bg: var(--bg-primary, #f8fafc);
    --doc-text: var(--text-primary, #1e293b);
    --doc-text-muted: var(--text-secondary, #64748b);
    --doc-border: var(--border, #e2e8f0);
    --doc-accent: var(--accent, #3b82f6);
    --doc-card-bg: rgba(255, 255, 255, 0.8);
    --doc-code-bg: #1e293b;
    --doc-code-text: #e2e8f0;

    position: relative;
    min-height: 100vh;
    color: var(--doc-text);
    background-color: var(--doc-bg);
    padding: 2rem 1rem 6rem;
    overflow-x: hidden;
    border-radius: 1.5rem;
  }

  :global([data-theme='dark']) .docs-main {
        --doc-bg: var(--bg-primary, #0f172a);
        --doc-text: var(--text-primary, #f1f5f9);
        --doc-text-muted: var(--text-secondary, #94a3b8);
        --doc-border: rgba(255, 255, 255, 0.1);
        --doc-card-bg: rgba(30, 41, 59, 0.7);
        --doc-code-bg: #020617;
  }

  /* --- BACKGROUND --- */
  /* Removed */

  .docs-container {
    position: relative; z-index: 1;
    max-width: 1400px; margin: 0 auto;
    width: 100%;
  }

  /* --- HEADER --- */
  .page-header {
    display: flex; align-items: center; gap: 1rem;
    margin-bottom: 3rem;
    flex-wrap: wrap;
  }
  .header-icon {
    width: 48px; height: 48px; min-width: 48px;
    background: linear-gradient(135deg, var(--doc-accent), #8b5cf6);
    color: white; border-radius: 12px;
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
  }
  .page-header h1 { font-size: 1.8rem; font-weight: 700; margin: 0; line-height: 1.2; }
  .subtitle { color: var(--doc-text-muted); font-size: 0.95rem; margin: 0; }

  /* --- LAYOUT GRID --- */
  .docs-layout {
    display: grid;
    grid-template-columns: 280px 1fr;
    gap: 2rem;
    align-items: start;
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
    border: 1px solid var(--doc-border);
    border-radius: 16px;
    padding: 1.5rem;
    max-height: calc(100vh - 4rem);
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: var(--doc-border) transparent;
  }

  .sidebar-header {
    display: flex; align-items: center; gap: 0.5rem;
    font-weight: 700; color: var(--doc-text-muted);
    text-transform: uppercase; font-size: 0.8rem; letter-spacing: 0.05em;
    margin-bottom: 1rem; padding-bottom: 0.75rem;
    border-bottom: 1px solid var(--doc-border);
  }

  .toc-link {
    display: flex;
    align-items: flex-start; /* Alignement en haut pour gérer le multiline */
    gap: 0.75rem;
    width: 100%; text-align: left;
    padding: 0.6rem 0.75rem;
    border: none; background: transparent;
    color: var(--doc-text);
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s;
    font-size: 0.9rem;

    /* GESTION DU RETOUR À LA LIGNE */
    white-space: normal; /* Permet le retour à la ligne */
    overflow-wrap: break-word; /* Coupe les mots trop longs si nécessaire */
    word-break: break-word;
    line-height: 1.4;
  }

  .toc-link:hover {
    background: rgba(59, 130, 246, 0.1);
    color: var(--doc-accent);
  }

  .doc-icon {
    color: var(--doc-text-muted); opacity: 0.7;
    min-width: 16px; /* Espace fixe pour l'icône */
    margin-top: 2px; /* Calage optique avec la première ligne de texte */
  }
  .toc-link:hover .doc-icon { color: var(--doc-accent); opacity: 1; }

  /* --- DOC CONTENT --- */
  .docs-content {
    display: flex; flex-direction: column; gap: 3rem;
    min-width: 0;
  }

  .doc-card {
    background: var(--doc-card-bg);
    backdrop-filter: blur(16px);
    border: 1px solid var(--doc-border);
    border-radius: 16px;
    padding: 2.5rem;
    box-shadow: 0 4px 6px -1px rgba(0,0,0,0.02);
    overflow: hidden;
  }

  .doc-header {
    margin-bottom: 2rem;
    padding-bottom: 1.5rem;
    border-bottom: 1px solid var(--doc-border);
  }

  .title-row {
    display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem;
    flex-wrap: wrap;
  }

  .doc-header h2 {
    font-size: 1.75rem; font-weight: 800; margin: 0;
    color: var(--doc-text);
    word-break: break-word;
    line-height: 1.3;
  }

  .filename-badge {
    font-family: monospace; font-size: 0.8rem;
    background: color-mix(in srgb, var(--doc-text) 5%, transparent); color: var(--doc-text-muted);
    padding: 0.25rem 0.5rem; border-radius: 6px;
    border: 1px solid var(--doc-border);
    word-break: break-all; /* Force la coupure des noms de fichiers très longs */
    max-width: 100%; /* Empêche de déborder */
  }

  /* --- MARKDOWN STYLES --- */

  :global(.doc-body) {
    color: var(--doc-text);
    line-height: 1.7;
    font-size: 1rem;
    overflow-wrap: break-word;
  }

  :global(.doc-body h1), :global(.doc-body h2), :global(.doc-body h3) {
    color: var(--doc-text);
    font-weight: 700;
    margin-top: 2rem; margin-bottom: 1rem;
    line-height: 1.3;
  }

  :global(.doc-body h1) { font-size: 1.5rem; border-bottom: 1px solid var(--doc-border); padding-bottom: 0.5rem; }
  :global(.doc-body h2) { font-size: 1.3rem; }
  :global(.doc-body h3) { font-size: 1.1rem; }

  :global(.doc-body p) { margin-bottom: 1.2rem; }

  :global(.doc-body ul), :global(.doc-body ol) {
    margin-bottom: 1.5rem; padding-left: 1.5rem;
  }

  :global(.doc-body li) { margin-bottom: 0.5rem; }

  :global(.doc-body pre) {
    background: var(--doc-code-bg);
    color: var(--doc-code-text);
    padding: 1.25rem;
    border-radius: 12px;
    overflow-x: auto;
    margin: 1.5rem 0;
    border: 1px solid rgba(255,255,255,0.1);
    font-family: 'Fira Code', monospace;
    font-size: 0.9rem;
    max-width: 100%;
  }

  :global(.doc-body code) {
    background: color-mix(in srgb, var(--doc-accent) 10%, transparent);
    color: var(--doc-accent);
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
    color: var(--doc-accent);
    text-decoration: none;
    font-weight: 500;
    border-bottom: 1px dashed var(--doc-accent);
    word-break: break-all;
  }
  :global(.doc-body a:hover) { border-bottom-style: solid; }

  :global(.doc-body table) {
    width: 100%; border-collapse: collapse; margin: 1.5rem 0;
    font-size: 0.95rem;
    display: block;
    overflow-x: auto;
  }
  :global(.doc-body th) {
    text-align: left; padding: 0.75rem;
    background: color-mix(in srgb, var(--doc-text) 5%, transparent);
    border-bottom: 2px solid var(--doc-border);
    font-weight: 600;
    white-space: nowrap;
  }
  :global(.doc-body td) {
    padding: 0.75rem;
    border-bottom: 1px solid var(--doc-border);
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

    .page-header h1 { font-size: 1.5rem; }
  }
</style>
