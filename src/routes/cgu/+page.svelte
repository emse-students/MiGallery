<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
</script>

<svelte:head>
	<title>Conditions Générales d'Utilisation - MiGallery</title>
</svelte:head>

<main class="cgu-main">
	<div class="page-background">
		<div class="gradient-blob blob-1"></div>
		<div class="gradient-blob blob-2"></div>
		<div class="gradient-blob blob-3"></div>
	</div>

	<div class="cgu-container">
		<h1>Conditions Générales d'Utilisation</h1>
		<p class="subtitle">MiGallery — Galerie photos de MiTV</p>

		<nav class="toc">
			<a href="#acces">Accès et Compte</a>
			<a href="#reconnaissance">Reconnaissance Faciale</a>
			<a href="#contenu">Contenu Interdit</a>
			<a href="#responsabilite">Responsabilité</a>
			<a href="#donnees">Données Personnelles</a>
			<a href="#resilition">Résiliation</a>
			<a href="#contact">Contact & Légal</a>
		</nav>

		<section id="acces" class="section">
			<h2><Icon name="lock" size={24} /> Accès et Compte</h2>
			<p>
				Pour utiliser MiGallery, vous devez avoir un compte lié à l'<strong>École Nationale Supérieure des Mines de Saint-Étienne</strong>.
			</p>
			<p>
				Vous êtes responsable de la confidentialité de vos identifiants. Toute action effectuée depuis votre compte vous sera imputée.
			</p>
		</section>

		<section id="reconnaissance" class="section">
			<h2><Icon name="camera" size={24} /> Reconnaissance Faciale</h2>
			<p>
				MiGallery propose une fonction d'organisation automatique des photos basée sur la reconnaissance faciale.
			</p>
			<h3>Cadre d'utilisation</h3>
			<ul>
				<li>Vous pouvez uploader une photo pour initialiser votre profil facial</li>
				<li>Cette photo est <strong>traitée, analysée et supprimée sous 24h</strong></li>
				<li>Seul l'empreinte biométrique (données mathématiques) est conservée</li>
				<li>Vous seul pouvez accéder à vos données biométriques</li>
			</ul>

			<h3>Consentement explicite</h3>
			<p>
				En uploadant une photo, vous consentez explicitement à ce que MiGallery traite vos données biométriques pour organiser vos photos.
				Vous pouvez retirer ce consentement à tout moment en nous contactant à <a href="mailto:bureau@mitv.fr">bureau@mitv.fr</a>.
			</p>
		</section>

		<section id="contenu" class="section">
			<h2><Icon name="alert-circle" size={24} /> Contenu Interdit</h2>
			<p>Vous ne devez pas uploader de contenu :</p>
			<ul>
				<li>Illégal, pornographique, violent ou haineux</li>
				<li>Enfreignant le droit d'auteur ou la vie privée d'autrui</li>
				<li>Contenant des virus ou code malveillant</li>
			</ul>
			<p>
				MiGallery se réserve le droit de supprimer le contenu illicite et suspendre l'accès sans préavis.
			</p>
		</section>

		<section id="responsabilite" class="section">
			<h2><Icon name="info" size={24} /> Responsabilité</h2>
			<p>
				Le service est fourni <strong>en l'état</strong>. Nous nous efforçons de le maintenir 24/7, mais ne garantissons pas l'absence de pannes ou de maintenance.
			</p>
		</section>

		<section id="donnees" class="section">
			<h2><Icon name="lock" size={24} /> Données Personnelles et Biométrie</h2>
			<p>
				Conformément au RGPD, le traitement de vos données biométriques repose sur votre consentement explicite.
			</p>
			<h3>Vos droits</h3>
			<ul>
				<li><strong>Retrait du consentement :</strong> Vous pouvez désactiver la reconnaissance faciale à tout moment</li>
				<li><strong>Droit d'accès :</strong> Vous pouvez voir les groupes de visages créés</li>
				<li><strong>Droit à l'oubli :</strong> Vous pouvez demander la suppression de vos données biométriques</li>
			</ul>
			<p>
				Vos données sont stockées sous forme chiffrée sur des serveurs situés dans l'Union Européenne.
			</p>
		</section>

		<section id="resilition" class="section">
			<h2><Icon name="x" size={24} /> Suppression de Compte</h2>
			<p>
				Vous pouvez supprimer votre compte à tout moment via l'interface. Toutes vos données seront supprimées selon nos délais de conservation.
			</p>
		</section>

		<section id="contact" class="section footer-section">
			<h2><Icon name="link" size={24} /> Contact et Mentions Légales</h2>
			<p>
				<strong>Éditeur :</strong> MiTV (Association étudiante)<br>
				<strong>Adresse :</strong> 20 bd Alexandre de Fraissinette, 42100 Saint-Étienne<br>
				<strong>Contact :</strong> <a href="mailto:bureau@mitv.fr">bureau@mitv.fr</a><br>
			</p>
			<p class="credits">
				Développé par <a href="https://github.com/DeMASKe/DeMASKe" target="_blank" rel="noopener">Jolan BOUDIN</a>
				et <a href="https://github.com/gd-pnjj" target="_blank" rel="noopener">Gabriel DUPONT</a>
			</p>
		</section>
	</div>
</main>

<style>
	.cgu-main {
		position: relative;
		min-height: 100vh;
		padding: 60px 0 80px;
		overflow-x: hidden;
	}

	.page-background {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: -1;
		pointer-events: none;
		overflow: hidden;
	}

	.gradient-blob {
		position: absolute;
		border-radius: 50%;
		filter: blur(100px);
		opacity: 0.1;
	}

	.blob-1 {
		width: 500px;
		height: 500px;
		background: var(--accent, #3b82f6);
		top: -100px;
		left: -100px;
		animation: float 20s ease-in-out infinite;
	}

	.blob-2 {
		width: 400px;
		height: 400px;
		background: #8b5cf6;
		bottom: -50px;
		right: -50px;
		animation: float 25s ease-in-out infinite reverse;
	}

	.blob-3 {
		width: 450px;
		height: 450px;
		background: var(--accent, #3b82f6);
		top: 50%;
		right: 10%;
		animation: float 22s ease-in-out infinite;
	}

	@keyframes float {
		0%, 100% { transform: translateY(0); }
		50% { transform: translateY(30px); }
	}

	.cgu-container {
		max-width: 800px;
		margin: 0 auto;
		padding: 0 20px;
	}

	h1 {
		font-size: 2.5rem;
		font-weight: 700;
		margin-bottom: 0.5rem;
		background: linear-gradient(90deg, var(--accent, #3b82f6), #8b5cf6);
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
	}

	.subtitle {
		font-size: 1.1rem;
		color: var(--text-secondary, #6b7280);
		margin-bottom: 2rem;
	}

	.toc {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		margin-bottom: 3rem;
		padding: 1.5rem;
		background: var(--bg-secondary, #f9fafb);
		border-radius: 12px;
		border: 1px solid var(--border, #e5e7eb);
	}

	.toc a {
		padding: 0.5rem 1rem;
		color: var(--accent, #3b82f6);
		text-decoration: none;
		font-weight: 500;
		border-radius: 8px;
		transition: all 0.2s ease;
		border: 1px solid transparent;
	}

	.toc a:hover {
		background: var(--accent, #3b82f6);
		color: white;
		border-color: var(--accent, #3b82f6);
	}

	.section {
		margin-bottom: 2.5rem;
		padding: 1.75rem;
		background: var(--bg-secondary, #ffffff);
		border-radius: 12px;
		border-left: 4px solid var(--accent, #3b82f6);
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
		scroll-margin-top: 80px;
	}

	.section h2 {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		font-size: 1.5rem;
		font-weight: 600;
		margin-bottom: 1rem;
		color: var(--text-primary);
	}

	.section h3 {
		font-size: 1.1rem;
		font-weight: 600;
		margin-top: 1.5rem;
		margin-bottom: 0.75rem;
		color: var(--text-primary);
	}

	.section p {
		font-size: 1rem;
		line-height: 1.6;
		color: var(--text-secondary, #4b5563);
		margin-bottom: 1rem;
	}

	.section ul {
		list-style: none;
		padding: 0;
		margin: 0 0 1rem 0;
	}

	.section li {
		padding: 0.6rem 0 0.6rem 2rem;
		position: relative;
		color: var(--text-secondary, #4b5563);
		line-height: 1.6;
	}

	.section li:before {
		content: '✓';
		position: absolute;
		left: 0;
		color: var(--accent, #3b82f6);
		font-weight: bold;
		font-size: 1.1rem;
	}

	.footer-section {
		background: linear-gradient(135deg, rgba(59, 130, 246, 0.05), rgba(139, 92, 246, 0.05));
		border-left-color: #8b5cf6;
		margin-top: 3rem;
	}

	.footer-section p {
		margin-bottom: 1.5rem;
	}

	.footer-section a {
		color: var(--accent, #3b82f6);
		text-decoration: none;
		font-weight: 500;
		transition: color 0.2s ease;
	}

	.footer-section a:hover {
		text-decoration: underline;
	}

	.credits {
		font-size: 0.95rem;
		color: var(--text-secondary, #6b7280);
		margin-top: 1rem;
		padding-top: 1rem;
		border-top: 1px solid var(--border, #e5e7eb);
	}

	@media (max-width: 768px) {
		.cgu-main {
			padding: 40px 0 60px;
		}

		h1 {
			font-size: 2rem;
		}

		.toc {
			flex-direction: column;
			gap: 0.5rem;
		}

		.toc a {
			width: 100%;
		}

		.section {
			padding: 1.5rem;
		}

		.section h2 {
			font-size: 1.25rem;
		}
	}

	@media (max-width: 480px) {
		.cgu-container {
			padding: 0 16px;
		}

		h1 {
			font-size: 1.75rem;
		}

		.subtitle {
			font-size: 1rem;
		}

		.section {
			padding: 1.25rem;
			border-left-width: 3px;
		}

		.section h2 {
			font-size: 1.1rem;
			gap: 0.5rem;
		}

		.section h3 {
			font-size: 1rem;
		}

		.section p {
			font-size: 0.95rem;
		}

		.section li {
			padding: 0.5rem 0 0.5rem 1.75rem;
			font-size: 0.95rem;
		}
	}
</style>
