<script lang="ts">
  import { page } from '$app/stores';
  // simple nav links for admin
  const links = [
    { href: '/admin', label: 'Docs' },
    { href: '/admin/api-docs', label: 'API Reference' },
    { href: '/admin/api-keys', label: 'API Keys' }
  ];
    // Svelte 5 children prop for {@render}
    let { children } = $props();
</script>

<svelte:head>
  <title>Admin — MiGallery</title>
</svelte:head>

<div class="admin-root">
  <aside class="sidebar">
    <div class="brand">MiGallery Admin</div>
    <nav>
      {#each links as l}
        <a class:active={$page.url.pathname === l.href} href={l.href}>{l.label}</a>
      {/each}
    </nav>
    <div class="meta">
      <small>Vous êtes dans la zone admin.</small>
    </div>
  </aside>

  <main class="content">
    <header class="topbar">
      <h1>Administration</h1>
      <div class="actions">
        <a href="/">Retour au site</a>
      </div>
    </header>

    <section class="panel">
      {@render children()}
    </section>
  </main>
</div>

<style>
  .admin-root { 
    display: flex; 
    min-height: 100vh; 
    background: var(--bg-primary); 
    color: var(--text-primary);
    gap: 0;
  }
  
  .sidebar { 
    width: 260px; 
    padding: 1.5rem 1rem;
    background: var(--bg-secondary); 
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
  }
  
  .brand { 
    font-weight: 700; 
    font-size: 1.25rem;
    margin-bottom: 2rem;
    color: var(--accent);
    padding: 0.5rem;
  }
  
  nav { flex: 1; }
  
  nav a { 
    display: block; 
    padding: 0.75rem 1rem; 
    border-radius: var(--radius-sm);
    color: var(--text-secondary); 
    text-decoration: none;
    margin-bottom: 0.25rem;
    transition: all 0.2s var(--ease);
    font-weight: 500;
  }
  
  nav a:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }
  
  nav a.active { 
    background: var(--accent); 
    color: white;
    font-weight: 600;
  }
  
  .meta { 
    margin-top: auto;
    padding-top: 1rem;
    border-top: 1px solid var(--border);
    color: var(--text-muted);
    font-size: 0.875rem;
  }
  
  .content { 
    flex: 1; 
    padding: 2rem;
    max-width: 1400px;
    overflow-y: auto;
  }
  
  .topbar { 
    display: flex; 
    justify-content: space-between; 
    align-items: center; 
    margin-bottom: 2rem;
    padding-bottom: 1rem;
    border-bottom: 1px solid var(--border);
  }
  
  .topbar h1 {
    font-size: 2rem;
    font-weight: 700;
    margin: 0;
  }
  
  .actions a {
    color: var(--accent);
    text-decoration: none;
    padding: 0.5rem 1rem;
    border-radius: var(--radius-sm);
    transition: all 0.2s var(--ease);
    font-weight: 500;
  }
  
  .actions a:hover {
    background: var(--accent-light);
  }
  
  .panel { 
    background: var(--bg-secondary); 
    border: 1px solid var(--border); 
    padding: 1.5rem; 
    border-radius: var(--radius);
    box-shadow: var(--shadow-sm);
  }
</style>
