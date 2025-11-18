<script lang="ts">
  import { page } from '$app/state';
  const docsRaw = (page as any).data?.docs || [];
  const docs = docsRaw.slice().sort((a: any,b: any) => {
    const an = a.filename.toLowerCase();
    const bn = b.filename.toLowerCase();
    if (an === 'api_endpoints.md' || an === 'api-endpoints.md') return -1;
    if (bn === 'api_endpoints.md' || bn === 'api-endpoints.md') return 1;
    return a.name.localeCompare(b.name);
  });
</script>

<svelte:head>
  <title>Admin — Documentation</title>
</svelte:head>

<main>
  <div class="header-row">
    <h1>Documentation interne</h1>
    <div class="actions">
      <a href="/admin/database">🗄️ Base de données</a> ·
      <a href="/admin/api-docs">📚 API Reference</a> ·
      <a href="/admin/api-keys">🔑 Gérer les clés API</a>
    </div>
  </div>

  <section class="card docs">
    <aside class="toc">
      <h2>Sommaire</h2>
      <ul>
        {#each docs as d}
          <li><a href={'#' + d.filename}>{d.name}</a></li>
        {/each}
      </ul>
    </aside>

    <div class="docs-list">
      {#each docs as d}
        <article id={d.filename} class="doc">
          <h2>{d.name} <small>({d.filename})</small></h2>
          <div class="doc-body">{@html d.html}</div>
        </article>
      {/each}
    </div>
  </section>
</main>

<style>
  main { display: block; }
  
  .header-row { 
    display: flex; 
    justify-content: space-between; 
    align-items: center; 
    margin-bottom: 1.5rem;
  }
  
  .header-row h1 {
    font-size: 1.75rem;
    font-weight: 700;
    margin: 0;
  }
  
  .actions {
    display: flex;
    gap: 1rem;
    font-size: 0.875rem;
  }
  
  .actions a { 
    color: var(--accent); 
    text-decoration: none;
    font-weight: 500;
  }
  
  .actions a:hover {
    text-decoration: underline;
  }
  
  .card.docs { 
    display: grid; 
    grid-template-columns: 260px 1fr; 
    gap: 1.5rem;
  }
  
  .toc { 
    background: var(--bg-tertiary); 
    padding: 1.25rem; 
    border-radius: var(--radius-sm); 
    border: 1px solid var(--border);
    position: sticky;
    top: 1rem;
    align-self: start;
    max-height: calc(100vh - 200px);
    overflow-y: auto;
  }
  
  .toc h2 {
    font-size: 0.875rem;
    font-weight: 700;
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 0 0 1rem 0;
    letter-spacing: 0.05em;
  }
  
  .toc ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  
  .toc li {
    margin-bottom: 0.5rem;
  }
  
  .toc a {
    color: var(--text-secondary);
    text-decoration: none;
    font-size: 0.875rem;
    transition: color 0.2s var(--ease);
  }
  
  .toc a:hover {
    color: var(--accent);
  }
  
  .docs-list { 
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  
  .doc { 
    padding: 1.5rem; 
    background: var(--bg-tertiary); 
    border: 1px solid var(--border); 
    border-radius: var(--radius-sm);
  }
  
  .doc h2 {
    margin-top: 0;
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--text-primary);
  }
  
  .doc small {
    color: var(--text-muted);
    font-weight: 400;
    font-size: 0.875rem;
  }
  
  :global(.doc-body) {
    color: var(--text-secondary);
    line-height: 1.7;
  }
  
  :global(.doc-body h1),
  :global(.doc-body h2),
  :global(.doc-body h3) {
    color: var(--text-primary);
    margin-top: 1.5rem;
    margin-bottom: 0.75rem;
  }
  
  :global(.doc-body pre) { 
    background: var(--bg-primary); 
    padding: 1rem; 
    border-radius: var(--radius-xs);
    overflow-x: auto;
    border: 1px solid var(--border);
    margin: 1rem 0;
  }
  
  :global(.doc-body code) { 
    background: var(--bg-primary); 
    padding: 0.2rem 0.4rem; 
    border-radius: 4px;
    font-size: 0.875em;
    color: var(--accent);
  }
  
  :global(.doc-body pre code) {
    background: transparent;
    padding: 0;
    color: var(--text-secondary);
  }
  
  :global(.doc-body ul),
  :global(.doc-body ol) {
    margin: 1rem 0;
    padding-left: 1.5rem;
  }
  
  :global(.doc-body a) {
    color: var(--accent);
    text-decoration: none;
  }
  
  :global(.doc-body a:hover) {
    text-decoration: underline;
  }
</style>


