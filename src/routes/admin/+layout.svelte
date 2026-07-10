<script lang="ts">
  import { page } from '$app/state';
  import './shared-admin.css';
  import {
    BookOpen,
    Activity,
    Webhook,
    ScrollText,
    Users,
    Key,
    Database,
    UsersRound,
    Trash2,
    ShieldCheck
  } from '$lib/icons';

  const links = [
    { href: '/admin', label: 'Documentation', icon: BookOpen },
    { href: '/admin/metrics', label: 'Santé', icon: Activity },
    { href: '/admin/api-docs', label: 'API Reference', icon: Webhook },
    { href: '/admin/logs', label: 'Logs', icon: ScrollText },
    { href: '/admin/users', label: 'Utilisateurs', icon: Users },
    { href: '/admin/api-keys', label: 'Gestion des clés', icon: Key },
    { href: '/admin/database', label: 'Base de données', icon: Database },
    { href: '/trombinoscope', label: 'Trombinoscope', icon: UsersRound },
    { href: '/corbeille', label: 'Corbeille', icon: Trash2 }
  ];
  let { children } = $props();
</script>

<svelte:head>
  <title>Admin - MiGallery</title>
</svelte:head>

<div class="admin-root">
  <aside class="sidebar">
    <div class="brand"><ShieldCheck size={22} /> Admin</div>
    <nav>
      {#each links as l}
        {@const Icon = l.icon}
        <a class:active={page.url.pathname === l.href} href={l.href}>
          <span class="icon"><Icon size={20} /></span>
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
    display: flex;
    align-items: center;
    gap: 0.5rem;
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
    display: flex;
    align-items: center;
    justify-content: center;
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
