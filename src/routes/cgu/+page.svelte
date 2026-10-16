<!-- These localized legal messages intentionally contain trusted inline HTML. -->
<!-- eslint-disable svelte/no-at-html-tags -->
<script lang="ts">
  import {
    Book,
    Building,
    Server,
    ScanEye,
    Database,
    Scale,
    Baby,
    Copyright,
    Info,
  } from '@lucide/svelte';
  import BackgroundBlobs from '$lib/components/BackgroundBlobs.svelte';
  import { m } from '$lib/paraglide/messages';
  import { getLocale } from '$lib/paraglide/runtime';
  import { TERMS_VERSION } from '$lib/legal';

  // The version is a date (src/lib/legal.ts), written once, never "today": a member's consent
  // row keeps the version they agreed to. UTC so the day does not shift with the reader's zone.
  const versionDate = new Date(TERMS_VERSION).toLocaleDateString(getLocale(), {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
</script>

<svelte:head>
  <title>{m.cgu_page_title()}</title>
  <meta name="description" content={m.cgu_meta_desc()} />
</svelte:head>

<!-- A div, not a <main>: the layout's <main> is the landmark and the page container (#10). -->
<div class="cgu-main">
  <BackgroundBlobs />

  <div class="cgu-container">
    <header class="cgu-header">
      <h1>{m.cgu_title()}</h1>
      <p class="subtitle">{m.cgu_subtitle()}</p>
      <p class="last-update">{m.cgu_last_update({ date: versionDate })}</p>
    </header>

    <nav class="toc">
      <a href="#definitions">{m.cgu_toc_definitions()}</a>
      <a href="#responsable">{m.cgu_toc_controller()}</a>
      <a href="#acces">{m.cgu_toc_access()}</a>
      <a href="#biometrie">{m.cgu_toc_biometrics()}</a>
      <a href="#donnees">{m.cgu_toc_data()}</a>
      <a href="#droits">{m.cgu_toc_rights()}</a>
      <a href="#age">{m.cgu_toc_age()}</a>
      <a href="#propriete">{m.cgu_toc_property()}</a>
      <a href="#contact">{m.cgu_toc_contact()}</a>
    </nav>

    <div class="content-wrapper">
      <section id="definitions" class="section">
        <h2><Book size={24} /> {m.cgu_s1_title()}</h2>
        <p>{m.cgu_s1_intro()}</p>
        <ul>
          <li>{@html m.cgu_s1_service()}</li>
          <li>{@html m.cgu_s1_editor()}</li>
          <li>{@html m.cgu_s1_user()}</li>
          <li>{@html m.cgu_s1_miconnect()}</li>
          <li>{@html m.cgu_s1_immich()}</li>
        </ul>
      </section>

      <section id="responsable" class="section">
        <h2><Building size={24} /> {m.cgu_s2_title()}</h2>
        <p>{@html m.cgu_s2_body()}</p>
      </section>

      <section id="acces" class="section">
        <h2><Server size={24} /> {m.cgu_s3_title()}</h2>
        <h3>{m.cgu_s3_auth_title()}</h3>
        <p>{m.cgu_s3_auth_body()}</p>
        <h3>{m.cgu_s3_hosting_title()}</h3>
        <p>{@html m.cgu_s3_hosting_body()}</p>
        <h3>{m.cgu_s3_recipients_title()}</h3>
        <p>{m.cgu_s3_recipients_body()}</p>
        <h3>{m.cgu_s3_avail_title()}</h3>
        <p>{m.cgu_s3_avail_body()}</p>
      </section>

      <section id="biometrie" class="section">
        <h2><ScanEye size={24} /> {m.cgu_s4_title()}</h2>
        <p>{@html m.cgu_s4_intro()}</p>

        <h3>{m.cgu_s4_tech_title()}</h3>
        <ul>
          <li>{@html m.cgu_s4_cluster()}</li>
          <li>{@html m.cgu_s4_init()}</li>
          <li>{@html m.cgu_s4_selfie()}</li>
        </ul>

        <h3>{m.cgu_s4_myphotos_title()}</h3>
        <p>{m.cgu_s4_myphotos_body()}</p>
        <p>{@html m.cgu_s4_spectator()}</p>

        <h3>{m.cgu_s4_revoke_title()}</h3>
        <p>{@html m.cgu_s4_revoke_body()}</p>
      </section>

      <section id="donnees" class="section">
        <h2><Database size={24} /> {m.cgu_s5_title()}</h2>
        <h3>{m.cgu_s5_items_title()}</h3>
        <ul>
          <li>{@html m.cgu_s5_item_account()}</li>
          <li>{@html m.cgu_s5_item_photos()}</li>
          <li>{@html m.cgu_s5_item_face()}</li>
          <li>{@html m.cgu_s5_item_logs()}</li>
        </ul>
        <h3>{m.cgu_s5_retention_title()}</h3>
        <ul>
          <li>{@html m.cgu_s5_retention_photos()}</li>
          <li>{@html m.cgu_s5_retention_account()}</li>
          <li>{@html m.cgu_s5_retention_logs()}</li>
        </ul>
        <h3>{m.cgu_s5_backups_title()}</h3>
        <p>{m.cgu_s5_backups_body()}</p>
      </section>

      <section id="droits" class="section">
        <h2><Scale size={24} /> {m.cgu_s6_title()}</h2>
        <p>{m.cgu_s6_intro()}</p>
        <p>{@html m.cgu_s6_how()}</p>
        <p>{@html m.cgu_s6_cnil()}</p>
      </section>

      <section id="age" class="section">
        <h2><Baby size={24} /> {m.cgu_s7_title()}</h2>
        <p>{@html m.cgu_s7_body()}</p>
      </section>

      <section id="propriete" class="section">
        <h2><Copyright size={24} /> {m.cgu_s8_title()}</h2>
        <p>{m.cgu_s8_body1()}</p>
        <p>{m.cgu_s8_body2()}</p>
      </section>

      <section id="contact" class="section footer-section">
        <h2><Info size={24} /> {m.cgu_contact_title()}</h2>
        <div class="footer-grid">
          <div>
            <h3>{m.cgu_contact_editor_title()}</h3>
            <p>{@html m.cgu_contact_editor_body()}</p>
          </div>
          <div>
            <h3>{m.cgu_contact_gdpr_title()}</h3>
            <p>{@html m.cgu_contact_gdpr_body()}</p>
          </div>
        </div>
        <div class="credits">
          <p>{@html m.cgu_credits()}</p>
          <p class="tech-stack">{m.cgu_tech_stack()}</p>
        </div>
      </section>
    </div>
  </div>
</div>

<style>
  .cgu-main {
    /* Accent tint (slightly stronger in dark for contrast). */
    --cgu-accent-tint: color-mix(in srgb, var(--accent) 15%, transparent);

    position: relative;
    min-height: 100vh;
    padding: 4rem 0 6rem;
    color: var(--text-primary);
    overflow-x: hidden;
  }

  :global([data-theme='dark']) .cgu-main {
    --cgu-accent-tint: color-mix(in srgb, var(--accent) 25%, transparent);
  }

  /* --- LAYOUT --- */
  .cgu-container {
    position: relative;
    z-index: 1;
    max-width: 800px;
    margin: 0 auto;
  }

  .cgu-header {
    text-align: center;
    margin-bottom: 3rem;
  }

  h1 {
    font-size: 2.5rem;
    font-weight: 800;
    margin-bottom: 0.5rem;
    color: var(--text-primary);
  }

  .subtitle {
    font-size: 1.125rem;
    color: var(--text-secondary);
  }

  .last-update {
    font-size: 0.875rem;
    color: var(--text-secondary);
    opacity: 0.7;
    margin-top: 0.5rem;
  }

  /* --- TABLE OF CONTENTS --- */
  .toc {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0.75rem;
    margin-bottom: 4rem;
  }

  .toc a {
    font-size: 0.9rem;
    font-weight: 500;
    color: var(--text-primary);
    text-decoration: none;
    padding: 0.5rem 1rem;
    border-radius: 9999px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    transition: all 0.2s;
  }

  .toc a:hover {
    border-color: var(--accent);
    color: var(--accent);
    background: var(--cgu-accent-tint);
  }

  /* --- SECTIONS --- */
  .section {
    margin-bottom: 2rem;
    padding: 2rem;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    scroll-margin-top: 2rem;
  }

  .section h2 {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    font-size: 1.5rem;
    font-weight: 700;
    margin-bottom: 1.5rem;
    color: var(--text-primary);
    border-bottom: 1px solid var(--border);
    padding-bottom: 1rem;
  }

  .section h3 {
    font-size: 1.1rem;
    font-weight: 600;
    margin: 1.5rem 0 0.75rem;
    color: var(--text-primary);
  }

  .section p,
  .section li {
    font-size: 1rem;
    line-height: 1.6;
    color: var(--text-secondary);
    margin-bottom: 0.75rem;
  }

  .section ul {
    list-style: none;
    padding-left: 0;
  }

  .section li {
    padding-left: 1.5rem;
    position: relative;
  }

  .section li::before {
    content: '•';
    color: var(--accent);
    position: absolute;
    left: 0;
    font-weight: bold;
  }

  /* Links come from {@html} message blocks, so they lack Svelte's scope
	   attribute; :global() lets the scoped section styles still reach them. */
  .section :global(a) {
    color: var(--accent);
    text-decoration: none;
    font-weight: 500;
  }

  .section :global(a:hover) {
    text-decoration: underline;
  }

  /* --- FOOTER SPECIFIC --- */
  .footer-section {
    background: var(--bg-secondary); /* Ensures it follows the theme */
    border: 1px solid var(--border);
    margin-top: 4rem;
  }

  .footer-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2rem;
    margin-bottom: 2rem;
  }

  .footer-section :global(.mail-link) {
    font-size: 1.1rem;
    font-weight: 600;
  }

  .credits {
    text-align: center;
    border-top: 1px solid var(--border);
    padding-top: 1.5rem;
    margin-top: 1.5rem;
    font-size: 0.9rem;
  }

  .tech-stack {
    font-size: 0.8rem;
    opacity: 0.6;
  }

  @media (max-width: 640px) {
    .cgu-main {
      padding-top: 2rem;
    }
    h1 {
      font-size: 2rem;
    }
    .section {
      padding: 1.5rem;
    }
    .footer-grid {
      grid-template-columns: 1fr;
      gap: 1rem;
    }
  }
</style>
