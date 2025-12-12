<script lang="ts">
    import Icon from '$lib/components/Icon.svelte';
</script>

<svelte:head>
    <title>Conditions Générales d'Utilisation - MiGallery</title>
    <meta name="description" content="CGU et Politique de Confidentialité de MiGallery, la galerie photo de l'Association MiTV.">
</svelte:head>

<main class="cgu-main">
    <div class="page-background">
        <div class="gradient-blob blob-1"></div>
        <div class="gradient-blob blob-2"></div>
        <div class="gradient-blob blob-3"></div>
    </div>

    <div class="cgu-container">
        <header class="cgu-header">
            <h1>Conditions Générales d'Utilisation</h1>
            <p class="subtitle">MiGallery — Galerie photos de l'Association MiTV</p>
            <p class="last-update">Dernière mise à jour : {new Date().toLocaleDateString('fr-FR')}</p>
        </header>

        <nav class="toc">
            <a href="#definitions">Définitions</a>
            <a href="#acces">Accès & Hébergement</a>
            <a href="#biometrie">Biométrie</a>
            <a href="#donnees">Données & Archivage</a>
            <a href="#propriete">Propriété</a>
            <a href="#responsabilite">Responsabilité</a>
            <a href="#contact">Contact</a>
        </nav>

        <div class="content-wrapper">
            <section id="definitions" class="section">
                <h2><Icon name="book" size={24} /> 1. Définitions</h2>
                <p>Pour la bonne compréhension des présentes conditions :</p>
                <ul>
                    <li><strong>Le Service :</strong> Désigne l'application MiGallery et son API.</li>
                    <li><strong>L'Éditeur :</strong> L'association étudiante MiTV.</li>
                    <li><strong>L'Utilisateur :</strong> Toute personne disposant d'un compte lié à l'École des Mines de Saint-Étienne (EMSE).</li>
                    <li><strong>Immich :</strong> La solution logicielle open-source utilisée en "backend" pour le stockage et l'analyse des photos.</li>
                </ul>
            </section>

            <section id="acces" class="section">
                <h2><Icon name="server" size={24} /> 2. Accès et Hébergement</h2>
                <h3>Authentification</h3>
                <p>
                    L'accès se fait via le portail d'authentification unique (OIDC) de l'École des Mines (CAS). MiGallery ne traite ni ne stocke aucun mot de passe.
                </p>
                <h3>Hébergement Physique</h3>
                <p>
                    Les données sont hébergées sur un serveur privé géré par l'association MiTV, situé physiquement à la <strong>Maison des Élèves, 20 Boulevard Alexandre de Fraissinette, 42100 Saint-Étienne</strong>. Aucune donnée photo n'est stockée sur des clouds publics.
                </p>
                <h3>Disponibilité</h3>
                <p>
                    Le service est fourni "en l'état". Des interruptions pour maintenance ou panne réseau peuvent survenir.
                </p>
            </section>

            <section id="biometrie" class="section">
                <h2><Icon name="scan-face" size={24} /> 3. Reconnaissance Faciale (Biométrie)</h2>
                <p>
                    MiGallery utilise une technologie de reconnaissance faciale pour faciliter le tri des photos. Ce traitement de <strong>données biométriques</strong> repose strictement sur votre <strong>consentement explicite</strong>.
                </p>

                <h3>Fonctionnement technique</h3>
                <ul>
                    <li><strong>Initialisation :</strong> L'utilisateur téléverse volontairement une photo de référence (selfie).</li>
                    <li><strong>Vérification :</strong> Le système vérifie l'unicité du visage.</li>
                    <li><strong>Traitement :</strong> La photo est analysée par le modèle d'IA <em>buffalo_l</em> (via Immich) pour générer un vecteur biométrique.</li>
                    <li><strong>Suppression de la source :</strong> La photo de référence est <strong>supprimée automatiquement sous 24h</strong>. Seul le vecteur biométrique chiffré est conservé.</li>
                </ul>

                <h3>Fonctionnalité "Mes Photos" et Partage</h3>
                <p>
                    L'activation donne accès à l'onglet "Mes Photos", visible par défaut uniquement par vous et les administrateurs.
                </p>
                <p>
                    <strong>Mode Spectateur :</strong> Vous pouvez autoriser d'autres utilisateurs à voir vos photos identifiées. Cet ajout relève de votre responsabilité et est révocable à tout moment.
                </p>

                <h3>Révocation</h3>
                <p>
                    Vous pouvez retirer votre consentement via <a href="/parametres">Paramètres → Zone de danger</a>. Cela entraîne la <strong>suppression immédiate</strong> de votre vecteur biométrique.
                </p>
            </section>

            <section id="donnees" class="section">
                <h2><Icon name="database" size={24} /> 4. Données Personnelles et Archivage</h2>
                <h3>Conservation</h3>
                <p>
                    MiGallery archive la vie étudiante. Les photos sont conservées pour une <strong>durée indéfinie</strong> à des fins historiques et patrimoniales.
                </p>
                <h3>Logs</h3>
                <p>
                    Des logs techniques (IP, horodatage) sont conservés temporairement pour la sécurité, sans stockage de mots de passe.
                </p>
                <h3>Vos droits</h3>
                <ul>
                    <li><strong>Droit d'accès :</strong> Voir toutes les photos associées à votre profil.</li>
                    <li><strong>Rectification/Suppression :</strong> Demander le floutage ou la suppression d'une photo préjudiciable en contactant <a href="mailto:bureau@mitv.fr">bureau@mitv.fr</a>.</li>
                    <li><strong>Droit à l'oubli :</strong> La suppression de votre compte efface vos préférences et données biométriques.</li>
                </ul>
            </section>

            <section id="propriete" class="section">
                <h2><Icon name="copyright" size={24} /> 5. Propriété Intellectuelle</h2>
                <p>
                    Seuls les membres de MiTV peuvent téléverser des albums. L'association conserve les droits d'exploitation.
                </p>
                <p>
                    Il est interdit de scraper le contenu, de l'utiliser à des fins commerciales, ou de tromper le système de reconnaissance faciale.
                </p>
            </section>

            <section id="contact" class="section footer-section">
                <h2><Icon name="info" size={24} /> Contact et Mentions Légales</h2>
                <div class="footer-grid">
                    <div>
                        <h3>Éditeur</h3>
                        <p>
                            Association MiTV (Mines TV)<br>
                            20 Bd Alexandre de Fraissinette<br>
                            42100 Saint-Étienne
                        </p>
                    </div>
                    <div>
                        <h3>Contact RGPD</h3>
                        <p>
                            Pour toute demande :<br>
                            <a href="mailto:bureau@mitv.fr" class="mail-link">bureau@mitv.fr</a>
                        </p>
                    </div>
                </div>
                <div class="credits">
                    <p>
                        Développé par <a href="https://github.com/DeMASKe" target="_blank" rel="noopener">Jolan BOUDIN</a>
                        et <a href="https://github.com/gd-pnjj" target="_blank" rel="noopener">Gabriel DUPONT</a>.
                    </p>
                    <p class="tech-stack">Propulsé par Immich • Hébergé à la ME</p>
                </div>
            </section>
        </div>
    </div>
</main>

<style>
    /* --- VARIABLES & THEME --- */
    /* Ces variables utilisent des valeurs par défaut mais devraient idéalement
       hériter de votre système de thème global (:root) */
    .cgu-main {
        --cgu-bg: var(--bg-primary, #ffffff);
        --cgu-text: var(--text-primary, #1f2937);
        --cgu-text-muted: var(--text-secondary, #6b7280);
        --cgu-card-bg: var(--bg-secondary, #ffffff);
        --cgu-border: var(--border, #e5e7eb);
        --cgu-accent: var(--accent, #3b82f6);
        --cgu-accent-glow: rgba(59, 130, 246, 0.15);

        position: relative;
        min-height: 100vh;
        padding: 4rem 0 6rem;
        color: var(--cgu-text);
        background-color: var(--cgu-bg); /* Fallback si pas de background global */
        overflow-x: hidden;
    }

    /* Support du Dark Mode si les variables CSS globales changent ou via media query */
    @media (prefers-color-scheme: dark) {
        .cgu-main {
            --cgu-bg: var(--bg-primary, #0f172a);
            --cgu-text: var(--text-primary, #f3f4f6);
            --cgu-text-muted: var(--text-secondary, #9ca3af);
            --cgu-card-bg: var(--bg-secondary, #1e293b);
            --cgu-border: var(--border, #334155);
            --cgu-accent-glow: rgba(59, 130, 246, 0.25);
        }
    }

    /* --- BACKGROUND --- */
    .page-background {
        position: fixed;
        inset: 0;
        z-index: 0;
        pointer-events: none;
        overflow: hidden;
    }

    .gradient-blob {
        position: absolute;
        border-radius: 50%;
        filter: blur(80px);
        opacity: 0.2;
    }

    .blob-1 {
        width: 60vw; height: 60vw;
        background: var(--cgu-accent);
        top: -20%; left: -20%;
        animation: float 20s ease-in-out infinite;
    }
    .blob-2 {
        width: 50vw; height: 50vw;
        background: #8b5cf6;
        bottom: -10%; right: -10%;
        animation: float 25s ease-in-out infinite reverse;
    }
    .blob-3 {
        width: 40vw; height: 40vw;
        background: var(--cgu-accent);
        top: 40%; left: 30%;
        animation: float 22s ease-in-out infinite;
    }

    @keyframes float {
        0%, 100% { transform: translate(0, 0); }
        50% { transform: translate(20px, 40px); }
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
        background: linear-gradient(135deg, var(--cgu-accent), #8b5cf6);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
    }

    .subtitle {
        font-size: 1.125rem;
        color: var(--cgu-text-muted);
    }

    .last-update {
        font-size: 0.875rem;
        color: var(--cgu-text-muted);
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
        color: var(--cgu-text);
        text-decoration: none;
        padding: 0.5rem 1rem;
        border-radius: 9999px;
        background: var(--cgu-card-bg);
        border: 1px solid var(--cgu-border);
        transition: all 0.2s;
    }

    .toc a:hover {
        border-color: var(--cgu-accent);
        color: var(--cgu-accent);
        background: var(--cgu-accent-glow);
    }

    /* --- SECTIONS --- */
    .section {
        margin-bottom: 2rem;
        padding: 2rem;
        background: var(--cgu-card-bg);
        border: 1px solid var(--cgu-border);
        border-radius: 1rem;
        scroll-margin-top: 2rem;
    }

    .section h2 {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        font-size: 1.5rem;
        font-weight: 700;
        margin-bottom: 1.5rem;
        color: var(--cgu-text);
        border-bottom: 1px solid var(--cgu-border);
        padding-bottom: 1rem;
    }

    .section h3 {
        font-size: 1.1rem;
        font-weight: 600;
        margin: 1.5rem 0 0.75rem;
        color: var(--cgu-text);
    }

    .section p, .section li {
        font-size: 1rem;
        line-height: 1.6;
        color: var(--cgu-text-muted);
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
        content: "•";
        color: var(--cgu-accent);
        position: absolute;
        left: 0;
        font-weight: bold;
    }

    .section a {
        color: var(--cgu-accent);
        text-decoration: none;
        font-weight: 500;
    }

    .section a:hover {
        text-decoration: underline;
    }

    /* --- FOOTER SPECIFIC --- */
    .footer-section {
        background: var(--cgu-card-bg); /* S'assure qu'il suit le thème */
        border: 1px solid var(--cgu-border);
        margin-top: 4rem;
    }

    .footer-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 2rem;
        margin-bottom: 2rem;
    }

    .mail-link {
        font-size: 1.1rem;
        font-weight: 600;
    }

    .credits {
        text-align: center;
        border-top: 1px solid var(--cgu-border);
        padding-top: 1.5rem;
        margin-top: 1.5rem;
        font-size: 0.9rem;
    }

    .tech-stack {
        font-size: 0.8rem;
        opacity: 0.6;
    }

    @media (max-width: 640px) {
        .cgu-main { padding-top: 2rem; }
        h1 { font-size: 2rem; }
        .section { padding: 1.5rem; }
        .footer-grid { grid-template-columns: 1fr; gap: 1rem; }
    }
</style>
