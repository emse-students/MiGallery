<script lang="ts">
	import { Book, Server, ScanEye, Database, Copyright, Info } from 'lucide-svelte';
	import BackgroundBlobs from '$lib/components/BackgroundBlobs.svelte';
	import { m } from '$lib/paraglide/messages';
	import { getLocale } from '$lib/paraglide/runtime';
</script>

<svelte:head>
	<title>{m.cgu_page_title()}</title>
	<meta name="description" content={m.cgu_meta_desc()} />
</svelte:head>

<main class="cgu-main">
	<BackgroundBlobs />

	<div class="cgu-container">
		<header class="cgu-header">
			<h1>{m.cgu_title()}</h1>
			<p class="subtitle">{m.cgu_subtitle()}</p>
			<p class="last-update">
				{m.cgu_last_update({ date: new Date().toLocaleDateString(getLocale()) })}
			</p>
		</header>

		<nav class="toc">
			<a href="#definitions">{m.cgu_toc_definitions()}</a>
			<a href="#acces">{m.cgu_toc_access()}</a>
			<a href="#biometrie">{m.cgu_toc_biometrics()}</a>
			<a href="#donnees">{m.cgu_toc_data()}</a>
			<a href="#propriete">{m.cgu_toc_property()}</a>
			<a href="#responsabilite">{m.cgu_toc_liability()}</a>
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
					<li>{@html m.cgu_s1_immich()}</li>
				</ul>
			</section>

			<section id="acces" class="section">
				<h2><Server size={24} /> {m.cgu_s2_title()}</h2>
				<h3>{m.cgu_s2_auth_title()}</h3>
				<p>{m.cgu_s2_auth_body()}</p>
				<h3>{m.cgu_s2_hosting_title()}</h3>
				<p>{@html m.cgu_s2_hosting_body()}</p>
				<h3>{m.cgu_s2_avail_title()}</h3>
				<p>{m.cgu_s2_avail_body()}</p>
			</section>

			<section id="biometrie" class="section">
				<h2><ScanEye size={24} /> {m.cgu_s3_title()}</h2>
				<p>{@html m.cgu_s3_intro()}</p>

				<h3>{m.cgu_s3_tech_title()}</h3>
				<ul>
					<li>{@html m.cgu_s3_init()}</li>
					<li>{@html m.cgu_s3_verify()}</li>
					<li>{@html m.cgu_s3_process()}</li>
					<li>{@html m.cgu_s3_delete()}</li>
				</ul>

				<h3>{m.cgu_s3_myphotos_title()}</h3>
				<p>{m.cgu_s3_myphotos_body()}</p>
				<p>{@html m.cgu_s3_spectator()}</p>

				<h3>{m.cgu_s3_revoke_title()}</h3>
				<p>{@html m.cgu_s3_revoke_body()}</p>
			</section>

			<section id="donnees" class="section">
				<h2><Database size={24} /> {m.cgu_s4_title()}</h2>
				<h3>{m.cgu_s4_retention_title()}</h3>
				<p>{@html m.cgu_s4_retention_body()}</p>
				<h3>{m.cgu_s4_logs_title()}</h3>
				<p>{m.cgu_s4_logs_body()}</p>
				<h3>{m.cgu_s4_rights_title()}</h3>
				<ul>
					<li>{@html m.cgu_s4_right_access()}</li>
					<li>{@html m.cgu_s4_right_rectif()}</li>
					<li>{@html m.cgu_s4_right_forget()}</li>
				</ul>
			</section>

			<section id="propriete" class="section">
				<h2><Copyright size={24} /> {m.cgu_s5_title()}</h2>
				<p>{m.cgu_s5_body1()}</p>
				<p>{m.cgu_s5_body2()}</p>
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
</main>

<style>
	.cgu-main {
		/* Accent glow (slightly stronger in dark for contrast). */
		--cgu-accent-glow: color-mix(in srgb, var(--accent) 15%, transparent);

		position: relative;
		min-height: 100vh;
		padding: 4rem 0 6rem;
		color: var(--text-primary);
		overflow-x: hidden;
	}

	:global([data-theme='dark']) .cgu-main {
		--cgu-accent-glow: color-mix(in srgb, var(--accent) 25%, transparent);
	}

	/* --- LAYOUT --- */
	.cgu-container {
		position: relative;
		z-index: 1;
		max-width: 800px;
		margin: 0 auto;
		padding: 0 1.5rem;
	}

	.cgu-header {
		text-align: center;
		margin-bottom: 3rem;
	}

	h1 {
		font-size: 2.5rem;
		font-weight: 800;
		margin-bottom: 0.5rem;
		background: linear-gradient(135deg, var(--accent), var(--edit));
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
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
		background: var(--cgu-accent-glow);
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
