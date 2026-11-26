<script lang="ts">
  import {
    Activity,
    Search,
    RotateCcw,
    Upload,
    Trash2,
    ImageMinus,
    Image as ImageIcon,
    FolderPlus,
    FolderPen,
    FolderX,
    UserPlus,
    UserPen,
    UserX,
    KeyRound,
    ChevronDown,
    ArrowRight,
  } from '@lucide/svelte';
  import { goto } from '$app/navigation';
  import { m } from '#lib/paraglide/messages.js';
  import { getLocale } from '#lib/paraglide/runtime.js';
  import AdminPage from '#lib/components/AdminPage.svelte';
  import EmptyState from '#lib/components/EmptyState.svelte';
  import {
    AUDIT_CATEGORIES,
    type AuditCategory,
    type AuditEntry,
    type AccessGrant,
  } from '#lib/audit-feed.ts';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  let searchTimer: ReturnType<typeof setTimeout> | null = null;

  /** Rebuild the query string from the current filters plus `next`; `before` is dropped unless given. */
  function navigate(next: { q?: string; actor?: string; category?: string; before?: number }) {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const sp = new URLSearchParams();
    const q = next.q ?? data.filters.q;
    const actor = next.actor ?? data.filters.actor;
    const category = next.category ?? data.filters.category;
    if (q) sp.set('q', q);
    if (actor) sp.set('actor', actor);
    if (category) sp.set('category', category);
    if (next.before) sp.set('before', String(next.before));
    const qs = sp.toString();
    void goto(qs ? `?${qs}` : '?', { reset: !!next.before });
  }

  function onSearchInput(e: Event & { currentTarget: HTMLInputElement }) {
    const value = e.currentTarget.value;
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => navigate({ q: value }), 300);
  }

  function resetFilters() {
    if (searchTimer) clearTimeout(searchTimer);
    void goto('?');
  }

  const hasFilters = $derived(!!(data.filters.q || data.filters.actor || data.filters.category));

  const CATEGORY_LABEL: Record<AuditCategory, () => string> = {
    uploads: m.logs_cat_uploads,
    deletions: m.logs_cat_deletions,
    albums: m.logs_cat_albums,
    covers: m.logs_cat_covers,
    users: m.logs_cat_users,
    api: m.logs_cat_api,
  };

  // --- Dates -------------------------------------------------------------------------------

  const locale = $derived(getLocale() === 'fr' ? 'fr-FR' : 'en-GB');

  function dayKey(iso: string): string {
    const d = new Date(iso);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  }

  function dayLabel(iso: string): string {
    const d = new Date(iso);
    const today = new Date();
    const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    const long = d.toLocaleDateString(locale, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric',
    });
    if (dayKey(iso) === dayKey(today.toISOString())) return `${m.logs_today()} · ${long}`;
    if (dayKey(iso) === dayKey(yesterday.toISOString())) return `${m.logs_yesterday()} · ${long}`;
    return long;
  }

  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });

  /** "14:48" or "14:48 - 14:59" for an entry that spans several minutes. */
  function timeRange(entry: AuditEntry): string {
    const a = time(entry.start);
    const b = time(entry.end);
    return a === b ? a : `${a} – ${b}`;
  }

  /** Entries cut into days, in the order they come (newest first). */
  const days = $derived.by(() => {
    const out: { key: string; label: string; entries: AuditEntry[] }[] = [];
    for (const entry of data.entries) {
      const key = dayKey(entry.end);
      let day = out[out.length - 1];
      if (!day || day.key !== key) {
        day = { key, label: dayLabel(entry.end), entries: [] };
        out.push(day);
      }
      day.entries.push(entry);
    }
    return out;
  });

  // --- Names and values --------------------------------------------------------------------

  const person = (id: string | null) => (id ? data.people[id] : undefined);
  const personName = (id: string | null) => person(id)?.name ?? (id ? id.slice(0, 8) : '');
  const albumName = (id: string | null) =>
    (id && data.albums[id]) ||
    (id ? `${m.logs_album_unknown()} ${id.slice(0, 8)}` : m.logs_album_unknown());

  function roleLabel(role: string | null | undefined): string | null {
    if (role === 'admin') return m.usr_role_admin();
    if (role === 'mitviste') return m.usr_role_mitviste();
    return null;
  }

  const FIELD_LABEL: Record<string, () => string> = {
    name: m.logs_field_name,
    date: m.logs_field_date,
    location: m.logs_field_location,
    visibility: m.logs_field_visibility,
    visible: m.logs_field_visible,
    first_name: m.logs_field_first_name,
    last_name: m.logs_field_last_name,
    role: m.logs_field_role,
    promo: m.logs_field_promo,
    formation: m.logs_field_formation,
  };
  const fieldLabel = (field: string) => FIELD_LABEL[field]?.() ?? field;

  function fieldValue(field: string, value: unknown): string {
    if (value === null || value === undefined || value === '') return m.logs_empty_value();
    if (typeof value === 'boolean') return value ? m.logs_yes() : m.logs_no();
    if (field === 'visibility') {
      if (value === 'private') return m.am_vis_private();
      if (value === 'authenticated') return m.am_vis_authenticated();
      if (value === 'unlisted') return m.am_vis_unlisted();
    }
    if (field === 'role') {
      if (value === 'user') return m.usr_role_user();
      return roleLabel(String(value)) ?? String(value);
    }
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  }

  const ACCESS_LABEL: Record<string, () => string> = {
    user: m.logs_access_user,
    promo: m.logs_access_promo,
    formation: m.logs_access_formation,
    tag: m.logs_access_tag,
  };
  const grantLabel = (g: AccessGrant) =>
    `${ACCESS_LABEL[g.kind]?.() ?? g.kind} · ${g.kind === 'user' ? personName(g.value) : g.value}`;

  const thumb = (assetId: string) =>
    `/api/immich/assets/${encodeURIComponent(assetId)}/thumbnail?size=thumbnail`;

  /** The tone of an entry's icon: what kind of change it is, at a glance. */
  function tone(entry: AuditEntry): 'add' | 'remove' | 'edit' | 'neutral' {
    switch (entry.kind) {
      case 'upload':
      case 'album_created':
      case 'user_created':
        return 'add';
      case 'assets_deleted':
      case 'assets_removed':
      case 'album_deleted':
      case 'user_deleted':
        return 'remove';
      case 'album_updated':
      case 'album_cover':
      case 'user_updated':
        return 'edit';
      default:
        return 'neutral';
    }
  }

  const ICONS = {
    upload: Upload,
    assets_deleted: Trash2,
    assets_removed: ImageMinus,
    album_created: FolderPlus,
    album_updated: FolderPen,
    album_cover: ImageIcon,
    album_deleted: FolderX,
    user_created: UserPlus,
    user_updated: UserPen,
    user_deleted: UserX,
    api_usage: KeyRound,
    other: Activity,
  } as const;

  /** Whether the entry has anything to show beyond its sentence. */
  function hasPanel(entry: AuditEntry): boolean {
    return entry.kind !== 'api_usage';
  }
</script>

<svelte:head>
  <title>{m.logs_page_title()}</title>
</svelte:head>

{#snippet album(id: string | null)}
  {#if id && data.albums[id]}
    <a class="chip album" href={`/albums/${encodeURIComponent(id)}`}>{albumName(id)}</a>
  {:else}
    <span class="chip album gone">{albumName(id)}</span>
  {/if}
{/snippet}

{#snippet who(entry: AuditEntry)}
  {#if entry.kind === 'api_usage'}
    <span class="who">{m.logs_api_key({ key: entry.keyPrefix ?? '' })}</span>
  {:else if entry.actor}
    <span class="who">{personName(entry.actor)}</span>
    {#if roleLabel(person(entry.actor)?.role)}
      <span class="role">{roleLabel(person(entry.actor)?.role)}</span>
    {/if}
  {:else}
    <span class="who system">{m.logs_system()}</span>
  {/if}
{/snippet}

{#snippet sentence(entry: AuditEntry)}
  {#if entry.kind === 'upload'}
    {#if entry.imported > 0}
      {m.logs_upload({ count: entry.imported })}
      {#if entry.albumId}{m.logs_into()} {@render album(entry.albumId)}{/if}
    {:else if entry.added > 0 && entry.albumId}
      {m.logs_added_to({ count: entry.added })} {@render album(entry.albumId)}
    {:else}
      {m.logs_upload_none()}
    {/if}
    {#if entry.duplicates > 0}
      <span class="chip muted">{m.logs_duplicates({ count: entry.duplicates })}</span>
    {/if}
  {:else if entry.kind === 'assets_deleted'}
    {m.logs_assets_deleted({ count: entry.count })}
  {:else if entry.kind === 'assets_removed'}
    {m.logs_assets_removed({ count: entry.count })} {@render album(entry.albumId)}
  {:else if entry.kind === 'album_created'}
    {m.logs_album_created()} {@render album(entry.albumId)}
  {:else if entry.kind === 'album_updated'}
    {m.logs_album_updated()} {@render album(entry.albumId)}
  {:else if entry.kind === 'album_cover'}
    {m.logs_album_cover()} {@render album(entry.albumId)}
  {:else if entry.kind === 'album_deleted'}
    {m.logs_album_deleted()} {@render album(entry.albumId)}
  {:else if entry.kind === 'user_created' || entry.kind === 'user_updated'}
    {entry.kind === 'user_created' ? m.logs_user_created() : m.logs_user_updated()}
    <span class="chip person">{personName(entry.userId)}</span>
  {:else if entry.kind === 'user_deleted'}
    {m.logs_user_deleted()}
  {:else if entry.kind === 'api_usage'}
    {m.logs_api_usage()} <code>{entry.method} {entry.path}</code>
  {:else if entry.kind === 'other'}
    <code>{entry.eventType}</code>
    {#if entry.targetType}<span class="chip muted">{entry.targetType}</span>{/if}
  {/if}
{/snippet}

{#snippet changesTable(changes: Record<string, [unknown, unknown]>)}
  <dl class="changes">
    {#each Object.entries(changes) as [field, [from, to]] (field)}
      <dt>{fieldLabel(field)}</dt>
      <dd>
        <span class="from">{fieldValue(field, from)}</span>
        <ArrowRight size={14} />
        <span class="to">{fieldValue(field, to)}</span>
      </dd>
    {/each}
  </dl>
{/snippet}

{#snippet snapshotTable(snapshot: Record<string, unknown>)}
  <p class="note">{m.logs_legacy_state()}</p>
  <dl class="changes">
    {#each Object.entries(snapshot) as [field, value] (field)}
      <dt>{fieldLabel(field)}</dt>
      <dd><span class="to">{fieldValue(field, value)}</span></dd>
    {/each}
  </dl>
{/snippet}

{#snippet thumbs(ids: string[], total: number)}
  <div class="thumbs">
    {#each ids as id (id)}
      <img
        src={thumb(id)}
        alt=""
        loading="lazy"
        onerror={(e) => e.currentTarget.classList.add('missing')}
      />
    {/each}
    {#if total > ids.length}<span class="more">+{total - ids.length}</span>{/if}
  </div>
{/snippet}

{#snippet panel(entry: AuditEntry)}
  {#if entry.kind === 'upload'}
    {#if entry.assetIds.length}
      <h4>{m.logs_photos()}</h4>
      {@render thumbs(entry.assetIds, entry.imported + entry.duplicates)}
    {/if}
    {#if entry.names.length}
      <h4>{m.logs_files()}</h4>
      <ul class="files">
        {#each entry.names as name (name)}<li>{name}</li>{/each}
      </ul>
    {/if}
  {:else if entry.kind === 'assets_deleted' || entry.kind === 'assets_removed'}
    {#if entry.assetIds.length}
      {@render thumbs(entry.assetIds, entry.count)}
    {/if}
  {:else if entry.kind === 'album_cover'}
    <div class="cover-swap">
      <figure>
        {#if entry.from}<img
            src={thumb(entry.from)}
            alt=""
            loading="lazy"
            onerror={(e) => e.currentTarget.classList.add('missing')}
          />{:else}<div class="blank"></div>{/if}
        <figcaption>{m.logs_cover_before()}</figcaption>
      </figure>
      <ArrowRight size={18} />
      <figure>
        {#if entry.to}<img
            src={thumb(entry.to)}
            alt=""
            loading="lazy"
            onerror={(e) => e.currentTarget.classList.add('missing')}
          />{/if}
        <figcaption>{m.logs_cover_after()}</figcaption>
      </figure>
    </div>
  {:else if entry.kind === 'album_updated'}
    {#if entry.changes && Object.keys(entry.changes).length}
      {@render changesTable(entry.changes)}
    {/if}
    {#if entry.access}
      <ul class="grants">
        {#each entry.access.added as g (`+${g.kind}${g.value}`)}
          <li class="added">{m.logs_access_added({ grant: grantLabel(g) })}</li>
        {/each}
        {#each entry.access.removed as g (`-${g.kind}${g.value}`)}
          <li class="removed">{m.logs_access_removed({ grant: grantLabel(g) })}</li>
        {/each}
      </ul>
    {/if}
    {#if entry.snapshot}
      {@render snapshotTable(entry.snapshot)}
    {/if}
  {:else if entry.kind === 'album_deleted'}
    {#if entry.assetsDeleted}
      <p>
        {m.logs_album_deleted_assets({ count: entry.assetsDeleted })}
        {albumName(entry.albumId)}
      </p>
    {/if}
  {:else if entry.kind === 'user_created' || entry.kind === 'user_updated' || entry.kind === 'user_deleted'}
    {#if entry.changes && Object.keys(entry.changes).length}
      {@render changesTable(entry.changes)}
    {/if}
    {#if entry.faceLinkChanged}<p>{m.logs_face_link_changed()}</p>{/if}
    {#if entry.snapshot}
      {@render snapshotTable(entry.snapshot)}
    {/if}
  {:else if entry.kind === 'other'}
    {#if entry.details}
      <h4>{m.logs_raw()}</h4>
      <pre>{JSON.stringify(entry.details, null, 2)}</pre>
    {:else}
      <p class="note">{m.logs_no_details()}</p>
    {/if}
  {/if}
  <p class="meta">
    {#if entry.ips.length}{m.logs_ip({ ip: entry.ips.join(', ') })} ·
    {/if}
    {m.logs_rows({ count: entry.rows })}
  </p>
{/snippet}

<AdminPage
  title={m.logs_title()}
  subtitle={m.logs_subtitle({ count: data.total })}
  icon={Activity}
  maxWidth="1100px"
>
  <div class="filter-bar">
    <div class="search-field">
      <Search size={16} />
      <input
        type="search"
        placeholder={m.logs_search_ph()}
        value={data.filters.q}
        oninput={onSearchInput}
      />
    </div>
    <select
      class="actor-select"
      value={data.filters.actor}
      onchange={(e) => navigate({ actor: e.currentTarget.value })}
    >
      <option value="">{m.logs_all_actors()}</option>
      {#each data.actors as a (a.id)}
        <option value={a.id}>{a.name}</option>
      {/each}
    </select>
    {#if hasFilters}
      <button type="button" class="btn" onclick={resetFilters}>
        <RotateCcw size={15} />
        {m.logs_reset()}
      </button>
    {/if}
  </div>

  <div class="categories" role="group">
    <button
      type="button"
      class="cat"
      aria-pressed={!data.filters.category}
      onclick={() => navigate({ category: '' })}>{m.logs_cat_all()}</button
    >
    {#each AUDIT_CATEGORIES as c (c)}
      <button
        type="button"
        class="cat"
        aria-pressed={data.filters.category === c}
        onclick={() => navigate({ category: c })}>{CATEGORY_LABEL[c]()}</button
      >
    {/each}
  </div>

  {#each days as day (day.key)}
    <section class="day">
      <h3 class="day-label">{day.label}</h3>
      <ol class="feed">
        {#each day.entries as entry (entry.id)}
          {@const Icon = ICONS[entry.kind]}
          <li class="entry">
            <span class="icon {tone(entry)}"><Icon size={16} /></span>
            <div class="body">
              <div class="line">
                {@render who(entry)}
                <span class="what">{@render sentence(entry)}</span>
              </div>
              {#if hasPanel(entry)}
                <details>
                  <summary>
                    <time datetime={entry.end}>{timeRange(entry)}</time>
                    <span class="toggle">{m.logs_details()} <ChevronDown size={14} /></span>
                  </summary>
                  <div class="panel">{@render panel(entry)}</div>
                </details>
              {:else}
                <time class="solo" datetime={entry.end}>{timeRange(entry)}</time>
              {/if}
            </div>
          </li>
        {/each}
      </ol>
    </section>
  {:else}
    <EmptyState title={m.logs_empty_title()} description={m.logs_empty_desc()} size="sm" />
  {/each}

  {#if data.nextCursor || !data.isFirstPage}
    <footer class="pager">
      {#if !data.isFirstPage}
        <button type="button" class="btn" onclick={() => navigate({})}>{m.logs_newest()}</button>
      {/if}
      {#if data.nextCursor}
        <button
          type="button"
          class="btn"
          onclick={() => navigate({ before: data.nextCursor ?? undefined })}
          >{m.logs_older()}</button
        >
      {/if}
    </footer>
  {/if}
</AdminPage>

<style>
  /* --- Filters --- */
  .filter-bar {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
    align-items: center;
    margin-bottom: 0.75rem;
  }
  .search-field {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex: 1;
    min-width: 220px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0 0.75rem;
    color: var(--text-muted);
  }
  .search-field input {
    flex: 1;
    border: none;
    background: transparent;
    color: var(--text-primary);
    padding: 0.6rem 0;
    font-size: 0.9rem;
    outline: none;
  }
  .actor-select {
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    padding: 0.6rem 0.75rem;
    font-size: 0.9rem;
    cursor: pointer;
    max-width: 100%;
  }
  .categories {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
    margin-bottom: 1.5rem;
  }
  .cat {
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text-secondary);
    border-radius: 999px;
    padding: 0.3rem 0.8rem;
    font-size: 0.85rem;
    cursor: pointer;
  }
  .cat[aria-pressed='true'] {
    background: var(--accent-light);
    border-color: var(--accent);
    color: var(--accent);
    font-weight: 600;
  }

  /* --- Feed --- */
  .day + .day {
    margin-top: 1.75rem;
  }
  .day-label {
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
    font-weight: 600;
    margin: 0 0 0.5rem;
  }
  .feed {
    list-style: none;
    margin: 0;
    padding: 0;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    overflow: hidden;
  }
  .entry {
    display: flex;
    gap: 0.85rem;
    padding: 0.85rem 1rem;
    align-items: flex-start;
  }
  .entry + .entry {
    border-top: 1px solid var(--border);
  }
  .icon {
    flex-shrink: 0;
    width: 32px;
    height: 32px;
    border-radius: 999px;
    display: grid;
    place-items: center;
    color: var(--text-secondary);
    background: color-mix(in srgb, var(--text-secondary) 14%, transparent);
  }
  .icon.add {
    color: var(--success);
    background: color-mix(in srgb, var(--success) 14%, transparent);
  }
  .icon.remove {
    color: var(--error);
    background: color-mix(in srgb, var(--error) 14%, transparent);
  }
  .icon.edit {
    color: var(--accent);
    background: var(--accent-light);
  }
  .body {
    flex: 1;
    min-width: 0;
  }
  .line {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.35rem;
    line-height: 1.5;
    color: var(--text-secondary);
  }
  .what {
    display: contents;
  }
  .who {
    font-weight: 600;
    color: var(--text-primary);
  }
  .who.system {
    color: var(--text-muted);
  }
  .role {
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 0.05rem 0.4rem;
    border-radius: var(--radius-xs);
    background: color-mix(in srgb, var(--text-secondary) 14%, transparent);
    color: var(--text-secondary);
  }
  .chip {
    font-weight: 600;
    color: var(--text-primary);
    padding: 0.05rem 0.45rem;
    border-radius: var(--radius-xs);
    background: color-mix(in srgb, var(--text-primary) 7%, transparent);
    text-decoration: none;
    overflow-wrap: anywhere;
  }
  a.chip:hover {
    background: var(--accent-light);
    color: var(--accent);
  }
  .chip.gone {
    font-style: italic;
    color: var(--text-muted);
  }
  .chip.muted {
    font-weight: 500;
    color: var(--text-muted);
    font-size: 0.85rem;
  }
  code {
    font-size: 0.85em;
    overflow-wrap: anywhere;
  }

  /* --- Details --- */
  time {
    font-size: 0.8rem;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
  time.solo {
    display: block;
    margin-top: 0.15rem;
  }
  details summary {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    margin-top: 0.15rem;
    cursor: pointer;
    list-style: none;
    width: fit-content;
  }
  details summary::-webkit-details-marker {
    display: none;
  }
  .toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    font-size: 0.8rem;
    color: var(--text-muted);
  }
  details[open] .toggle :global(svg) {
    transform: rotate(180deg);
  }
  summary:hover .toggle {
    color: var(--accent);
  }
  .panel {
    margin-top: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    font-size: 0.875rem;
    color: var(--text-secondary);
  }
  .panel h4 {
    margin: 0;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
  }
  .panel p {
    margin: 0;
  }
  .note {
    font-style: italic;
    color: var(--text-muted);
  }
  .meta {
    font-size: 0.8rem;
    color: var(--text-muted);
  }
  .changes {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.35rem 1rem;
    margin: 0;
  }
  .changes dt {
    color: var(--text-muted);
  }
  .changes dd {
    margin: 0;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.4rem;
    min-width: 0;
  }
  .from {
    text-decoration: line-through;
    color: var(--text-muted);
    overflow-wrap: anywhere;
  }
  .to {
    color: var(--text-primary);
    font-weight: 500;
    overflow-wrap: anywhere;
  }
  .grants {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .grants .added {
    color: var(--success);
  }
  .grants .removed {
    color: var(--error);
  }
  .thumbs {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    align-items: center;
  }
  .thumbs img,
  .cover-swap img,
  .cover-swap .blank {
    width: 56px;
    height: 56px;
    object-fit: cover;
    border-radius: var(--radius-xs);
    background: color-mix(in srgb, var(--text-primary) 7%, transparent);
  }
  .cover-swap img,
  .cover-swap .blank {
    width: 96px;
    height: 96px;
  }
  :global(img.missing) {
    visibility: hidden;
  }
  .more {
    font-size: 0.85rem;
    color: var(--text-muted);
    padding: 0 0.4rem;
  }
  .files {
    margin: 0;
    padding-left: 1.1rem;
    columns: 2 14rem;
    font-family: monospace;
    font-size: 0.8rem;
  }
  .files li {
    overflow-wrap: anywhere;
  }
  .cover-swap {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .cover-swap figure {
    margin: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
  }
  .cover-swap figcaption {
    font-size: 0.75rem;
    color: var(--text-muted);
  }
  pre {
    margin: 0;
    padding: 0.75rem;
    border-radius: var(--radius-xs);
    background: color-mix(in srgb, var(--text-primary) 5%, transparent);
    font-size: 0.75rem;
    overflow-x: auto;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  /* --- Pager --- */
  .pager {
    display: flex;
    justify-content: center;
    gap: 0.75rem;
    margin-top: 1.5rem;
  }

  @media (max-width: 600px) {
    .entry {
      padding: 0.75rem;
      gap: 0.65rem;
    }
    .changes {
      grid-template-columns: 1fr;
      gap: 0.1rem;
    }
    .changes dd {
      margin-bottom: 0.4rem;
    }
  }
</style>
