<script lang="ts">
  import { page } from '$app/stores';
  import './shared-admin.css';
  const links = [
    { href: '/admin', label: 'Documentation', icon: '📚' },
    { href: '/admin/api-docs', label: 'API Reference', icon: '📡' },
    { href: '/admin/logs', label: 'Logs', icon: '📜' },
    { href: '/admin/api-keys', label: 'Gestion des clés', icon: '🔑' },
    { href: '/admin/database', label: 'Base de données', icon: '🗄️' }
  ];
    let { children } = $props();
</script>

<svelte:head>
  <title>Admin — MiGallery</title>
</svelte:head>

<div class="admin-root">
  <aside class="sidebar">
    <div class="brand">🛠️ Admin</div>
    <nav>
      {#each links as l}
        <a class:active={$page.url.pathname === l.href} href={l.href}>
          <span class="icon">{l.icon}</span>
          <span>{l.label}</span>
        </a>
      {/each}
    </nav>
    <div class="meta">
      <a href="/" class="back-home">← Retour au site</a>
      <small>v1.0 • Admin Panel</small>
    </div>
  </aside>

  <main class="content">
    {@render children()}
  </main>
</div>

<style>
  .admin-root {
    display: flex;
    min-height: 100vh;
    background: var(--bg-primary);
    color: var(--text-primary);
    gap: 0;
    border-radius: 1.5rem;
  }

  .sidebar {
    width: 260px;
    padding: 1.5rem 1rem;
    background: var(--bg-secondary);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    position: sticky;
    top: 0;
    height: 100vh;
    border-radius: 1.5rem;
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
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    text-decoration: none;
    margin-bottom: 0.25rem;
    transition: all 0.2s var(--ease);
    font-weight: 500;
    font-size: 0.9375rem;
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

  .icon {
    font-size: 1.25rem;
    min-width: 1.5rem;
  }

  .meta {
    margin-top: auto;
    padding-top: 1rem;
    border-top: 1px solid var(--border);
    color: var(--text-muted);
    font-size: 0.875rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .back-home {
    color: var(--accent);
    text-decoration: none;
    font-weight: 500;
    transition: all 0.2s var(--ease);
  }

  .back-home:hover {
    color: var(--text-primary);
  }

  .content {
    flex: 1;
    padding: 0;
    max-width: 100%;
    overflow-y: auto;
  }

  @media (max-width: 768px) {
    .sidebar {
      width: 200px;
    }
  }

  /* Force sidebar visible in case some pages override it (diagnostic / fallback) */
  :global(.sidebar) {
    display: flex !important;
    opacity: 1 !important;
    visibility: visible !important;
    transform: none !important;
    z-index: 50 !important;
  }
</style>
