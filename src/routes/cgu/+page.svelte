<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
</script>

<svelte:head>
	<title>Politique de Confidentialité - MiGallery</title>
</svelte:head>

<main class="cgu-main">
	<div class="page-background">
		<div class="gradient-blob blob-1"></div>
		<div class="gradient-blob blob-2"></div>
		<div class="gradient-blob blob-3"></div>
	</div>

	<div class="cgu-container">
		<nav class="legal-nav">
			<a href="#cgu">CGU</a>
			<a href="#politique">Politique de confidentialité</a>
			<a href="#mentions">Mentions Légales</a>
		</nav>

		<h1 id="page-title">Informations Légales — MiGallery</h1>

		<section id="cgu" class="cgu-section">
			<h2>Conditions Générales d'Utilisation (CGU)</h2>
			<p>
				Les présentes Conditions Générales d'Utilisation régissent l'accès et l'utilisation du service MiGallery.
				Elles définissent les obligations des utilisateurs et de l'éditeur. Pour toute question détaillée,
				veuillez contacter l'équipe (voir Mentions Légales).
			</p>
		</section>

		<section id="politique" class="cgu-section">
			<h2>Politique de Confidentialité</h2>
			<section>
				<h3>1. Objectif Unique</h3>
				<p>
					Cette fonctionnalité sert uniquement à organiser votre bibliothèque en regroupant les photos d'une
					même personne. Elle ne sert à aucune fin de surveillance ou de profilage publicitaire.
				</p>
			</section>

			<section>
				<h3>2. Consentement Explicite</h3>
				<p>
					Conformément à l'article 9 du RGPD, nous ne traitons vos données biométriques qu'avec votre accord
					préalable et explicite. Cette option est désactivée par défaut.
				</p>
			</section>

			<section>
				<h3>3. Données Traitées</h3>
				<p>
					Nous analysons les visages sur vos photos pour créer une empreinte mathématique (gabarit).
					C'est cette suite de chiffres, et non votre identité civile, que le système utilise pour
					les regroupements.
				</p>
			</section>

			<section>
				<h3>4. Pas de Partage, Pas de Vente</h3>
				<ul>
					<li>Vos modèles de visages sont strictement privés et liés à votre seul compte.</li>
					<li>Ils ne sont jamais partagés avec des tiers ni vendus.</li>
					<li>Ils ne sont jamais croisés avec d'autres bases de données externes.</li>
				</ul>
			</section>

			<section>
				<h3>5. Vos Droits (Article 15 à 21 du RGPD)</h3>
				<p>Concernant vos données biométriques, vous disposez des droits suivants :</p>
				<ul>
					<li><strong>Droit de retrait du consentement :</strong> Vous pouvez désactiver l'option à tout moment.</li>
					<li><strong>Droit d'accès et de rectification :</strong> Vous pouvez voir les groupes de visages créés et corriger les erreurs (ex: mauvaise identification).</li>
					<li><strong>Droit à l'effacement (« Droit à l'oubli ») :</strong> Vous pouvez demander la suppression totale de vos modèles de visages.</li>
				</ul>
			</section>

			<section>
				<h3>6. Sécurité</h3>
				<p>
					Vos données biométriques sont stockées sous forme chiffrée sur des serveurs situés dans l'Union
					Européenne (serveur MiTV, stocké à la Maison de Élèves).
				</p>
			</section>

			<section class="consent-box">
				<h3>Consentement</h3>
				<p>
					J'accepte que MiGallery analyse mes photos pour créer des modèles biométriques de visages
					afin de faciliter leur classement. Je comprends que je peux retirer ce consentement à tout moment,
					entraînant la suppression immédiate de ces données.
				</p>
				<div class="consent-actions">
					<button class="btn btn-primary">
						<Icon name="check" size={20} />
						J'accepte
					</button>
					<button class="btn btn-secondary">
						<Icon name="x" size={20} />
						Je refuse
					</button>
				</div>
			</section>
		</section>

		<section id="mentions" class="cgu-section">
			<h2>Mentions Légales</h2>
			<section>
				<h3>1. Éditeur du site</h3>
				<p>
					Le site <a href="https://gallery.mitv.fr/" target="_blank" rel="noopener">https://gallery.mitv.fr/</a> est édité par MiTV, association étudiante.<br>
					Domiciliation: 20 bd Alexandre de Fraissinette 42100 Saint Etienne<br>
					Association inscrite au RCS de Saint Etienne, sous le numéro SIREN: 920043585<br>
					Directeur de la publication : Jolan Boudin<br>
					Contact : <a href="mailto:bureau@mitv.fr">bureau@mitv.fr</a>
				</p>
			</section>

			<section>
				<h3>2. Hébergement du site</h3>
				<p>
					Le site est hébergé par :<br>
					• MiTV<br>
					• Adresse : 20 bd Alexandre de Fraissinette 42100 Saint Etienne
				</p>
			</section>

			<section>
				<h3>3. Propriété Intellectuelle</h3>
				<p>
					L'ensemble de ce site (structure, design, textes, logo, images fournies par l'éditeur) relève de la législation française et internationale sur le droit d'auteur et la propriété intellectuelle.
					Toute reproduction, totale ou partielle, sans l'autorisation expresse de l'éditeur est interdite.
					Note : Les photos téléchargées par les utilisateurs restent leur entière propriété (voir <a href="#cgu">CGU</a>).
				</p>
			</section>

			<section>
				<h3>4. Données Personnelles et Biométrie</h3>
				<p>
					Le traitement des données personnelles, et spécifiquement l'usage de la reconnaissance faciale, est détaillé dans notre <a href="#politique">Politique de Confidentialité</a>.
				</p>
			</section>
		</section>
	</div>
</main>

<style>
	.cgu-main {
		position: relative;
		min-height: 100vh;
		padding: var(--container-padding) 0;
		overflow-x: hidden;
	}

	.page-background {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		pointer-events: none;
		z-index: -1;
		overflow: hidden;
	}

	.gradient-blob {
		position: absolute;
		opacity: 0.1;
		filter: blur(100px);
		border-radius: 50%;
	}

	.blob-1 {
		width: 400px;
		height: 400px;
		background: var(--accent);
		top: -100px;
		left: -100px;
		animation: float 20s infinite ease-in-out;
	}

	.blob-2 {
		width: 300px;
		height: 300px;
		background: #8b5cf6;
		bottom: -50px;
		right: -50px;
		animation: float 25s infinite ease-in-out reverse;
	}

	.blob-3 {
		width: 350px;
		height: 350px;
		background: var(--accent);
		top: 50%;
		right: 10%;
		animation: float 22s infinite ease-in-out;
	}

	@keyframes float {
		0%, 100% {
			transform: translateY(0px);
		}
		50% {
			transform: translateY(30px);
		}
	}

	.cgu-container {
		max-width: 900px;
		margin: 0 auto;
		padding: 0 var(--container-padding);
	}

	h1 {
		font-size: 2.5rem;
		font-weight: 700;
		margin-bottom: 2rem;
		background: linear-gradient(90deg, var(--accent), #8b5cf6);
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
	}

	.cgu-section {
		margin-bottom: 2.5rem;
		padding: 1.5rem;
		background: var(--bg-secondary);
		border-radius: var(--radius-lg);
		border-left: 4px solid var(--accent);
	}

	.cgu-section h2 {
		font-size: 1.5rem;
		font-weight: 600;
		margin-bottom: 1rem;
		color: var(--text-primary);
	}

	.cgu-section p {
		font-size: 1rem;
		line-height: 1.6;
		color: var(--text-secondary);
		margin-bottom: 1rem;
	}

	.cgu-section ul {
		list-style: none;
		padding: 0;
		margin: 0;
	}

	.cgu-section li {
		padding: 0.75rem 0 0.75rem 2rem;
		position: relative;
		color: var(--text-secondary);
		line-height: 1.6;
	}

	.cgu-section li:before {
		content: '→';
		position: absolute;
		left: 0;
		color: var(--accent);
		font-weight: 600;
	}

	.consent-box {
		background: linear-gradient(135deg, rgba(59, 130, 246, 0.1), rgba(139, 92, 246, 0.1));
		border-left-color: #8b5cf6;
		margin-top: 3rem;
	}

	.consent-box h2 {
		color: #8b5cf6;
	}

	.consent-actions {
		display: flex;
		gap: 1rem;
		margin-top: 1.5rem;
		flex-wrap: wrap;
	}

	.btn {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 1.5rem;
		border: none;
		border-radius: var(--radius);
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s ease;
		font-size: 1rem;
	}

	.btn-primary {
		background: linear-gradient(90deg, var(--accent), #8b5cf6);
		color: white;
		box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
	}

	.btn-primary:hover {
		transform: translateY(-2px);
		box-shadow: 0 8px 24px rgba(59, 130, 246, 0.4);
	}

	.btn-secondary {
		background: var(--bg-tertiary);
		color: var(--text-primary);
		border: 1px solid var(--border);
	}

	.btn-secondary:hover {
		background: var(--bg-elevated);
		border-color: var(--accent);
	}

	@media (max-width: 768px) {
		h1 {
			font-size: 2rem;
		}

		.cgu-section {
			padding: 1.25rem;
			margin-bottom: 1.75rem;
		}

		.cgu-section h2 {
			font-size: 1.25rem;
		}

		.cgu-section p {
			font-size: 0.95rem;
		}

		.consent-actions {
			flex-direction: column;
		}

		.btn {
			justify-content: center;
			width: 100%;
		}
	}

	@media (max-width: 480px) {
		h1 {
			font-size: 1.75rem;
			margin-bottom: 1.5rem;
		}

		.cgu-container {
			padding: 0 1rem;
		}

		.cgu-section {
			padding: 1rem;
			border-left-width: 3px;
		}

		.cgu-section h2 {
			font-size: 1.1rem;
			margin-bottom: 0.75rem;
		}

		.cgu-section p {
			font-size: 0.9rem;
		}

		.cgu-section li {
			padding: 0.5rem 0 0.5rem 1.5rem;
			font-size: 0.9rem;
		}
	}
</style>
