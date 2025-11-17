<script lang="ts">
  import { page } from '$app/state';
  const endpoints = (page as any).data?.endpoints || [];
  function esc(s: string) { return s.replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
</script>

<svelte:head>
  <title>Admin — API Reference</title>
</svelte:head>

<main>
  <div class="header-row">
    <h1>API Reference</h1>
    <div class="hint">Authentification: cookie signé (admin) ou clés API</div>
  </div>

  {#each endpoints as group}
    <section class="card" aria-labelledby={group.group}>
      <h2 id={group.group}>{group.group}</h2>
      {#if group.description}
        <p class="muted">{group.description}</p>
      {/if}

      <div class="endpoints">
        {#each group.items as it}
          <article class="endpoint">
            <header>
              <strong class="method">{it.method}</strong>
              <code class="path">{it.path}</code>
              {#if it.summary}
                <div class="summary">{it.summary}</div>
              {/if}
            </header>
            {#if it.params}
              <div class="params"><strong>Params:</strong>
                <ul>
                  {#each it.params as p}
                    <li><strong>{p.name}</strong> — {p.desc} ({p.in})</li>
                  {/each}
                </ul>
              </div>
            {/if}

            <div class="example">
              <div class="example-label">Exemple curl</div>
              <pre>{@html esc(it.exampleCurl || '')}</pre>
            </div>
            {#if it.noteAuth}
              <div class="note">{it.noteAuth}</div>
            {/if}
          </article>
        {/each}
      </div>
    </section>
  {/each}

  <section class="card">
    <h2>Utiliser les clés API</h2>
    <p>Créez une clé dans <a href="/admin/api-keys">Administration → API Keys</a>. Les clés sont affichées une seule fois lors de la création ; stockez-les en lieu sûr.</p>
    <p>Exemple d'appel authentifié avec clé :</p>
    <pre>curl -H "x-api-key: YOUR_KEY_HERE" "http://localhost:5173/api/external/media"</pre>
    <p>Pour les endpoints administratifs, vous pouvez utiliser la session (cookie signé) :</p>
    <pre>curl -H "Cookie: current_user_id=&lt;signed_value&gt;" "http://localhost:5173/api/admin/api-keys"</pre>
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
  
  .hint { 
    color: var(--text-muted);
    font-size: 0.875rem;
  }
  
  .card { 
    background: var(--bg-tertiary); 
    border: 1px solid var(--border); 
    padding: 1.5rem; 
    border-radius: var(--radius-sm); 
    margin-bottom: 1.5rem;
  }
  
  .card h2 {
    font-size: 1.25rem;
    font-weight: 600;
    margin: 0 0 0.5rem 0;
    color: var(--text-primary);
  }
  
  .card > p {
    color: var(--text-secondary);
    line-height: 1.6;
    margin: 0.5rem 0;
  }
  
  .card a {
    color: var(--accent);
    text-decoration: none;
    font-weight: 500;
  }
  
  .card a:hover {
    text-decoration: underline;
  }
  
  .muted {
    color: var(--text-muted);
    margin-bottom: 1rem;
    font-size: 0.9375rem;
  }
  
  .endpoints { 
    display: flex; 
    flex-direction: column; 
    gap: 1rem;
    margin-top: 1rem;
  }
  
  .endpoint { 
    padding: 1rem; 
    border: 1px solid var(--border); 
    border-radius: var(--radius-xs); 
    background: var(--bg-secondary);
    transition: all 0.2s var(--ease);
  }
  
  .endpoint:hover {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }
  
  .endpoint header {
    margin-bottom: 0.75rem;
  }
  
  .method { 
    display: inline-block; 
    padding: 0.25rem 0.625rem; 
    border-radius: 4px; 
    background: var(--accent); 
    color: white;
    margin-right: 0.75rem;
    font-weight: 700;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  
  .path { 
    background: transparent; 
    color: var(--accent);
    font-family: 'Courier New', monospace;
    font-size: 0.9375rem;
    font-weight: 600;
  }
  
  .summary { 
    color: var(--text-secondary); 
    margin-top: 0.5rem;
    font-size: 0.9375rem;
  }
  
  .params {
    margin: 0.75rem 0;
    padding: 0.75rem;
    background: var(--bg-primary);
    border-radius: var(--radius-xs);
    border: 1px solid var(--border);
  }
  
  .params strong {
    color: var(--text-primary);
  }
  
  .params ul { 
    margin: 0.5rem 0 0 1.5rem;
    color: var(--text-secondary);
  }
  
  .params li {
    margin-bottom: 0.25rem;
  }
  
  .example {
    margin-top: 0.75rem;
  }
  
  .example-label { 
    font-weight: 600;
    margin-bottom: 0.5rem;
    color: var(--text-primary);
    font-size: 0.875rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  
  pre { 
    background: var(--bg-primary); 
    padding: 1rem; 
    border-radius: var(--radius-xs); 
    overflow-x: auto;
    border: 1px solid var(--border);
    font-size: 0.875rem;
    line-height: 1.5;
    color: var(--text-secondary);
  }
  
  .note { 
    margin-top: 0.75rem;
    padding: 0.625rem 0.875rem;
    background: rgba(59, 130, 246, 0.1);
    border-left: 3px solid var(--accent);
    border-radius: 4px;
    color: var(--text-secondary);
    font-size: 0.875rem;
  }
</style>
