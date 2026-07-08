<script lang="ts">
  import { page } from '$app/state';
  interface Param {
    name: string;
    in: string;
    desc: string;
  }
  interface Endpoint {
    method: string;
    path: string;
    requiredScopes?: string[];
    summary?: string;
    notes?: string;
    params?: Param[];
    exampleCurl?: string;
    noteAuth?: string;
    exampleResponse?: string;  // New field
  }
  interface EndpointGroup {
    group: string;
    description?: string;
    items: Endpoint[];
  }
  const endpoints = (page.data as { endpoints?: EndpointGroup[] }).endpoints || [];
  function esc(s: string) {
  	return s.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  const isAdmin = $derived(page.data.session?.user?.role === 'admin');
</script>

<svelte:head>
  <title>Admin — Documentation API</title>
</svelte:head>

{#if !isAdmin}
  <p>Accès réservé aux administrateurs.</p>
{:else}
  <main>
    <div class="header">
      <h1>📡 Documentation API MiGallery</h1>
      <p class="subtitle">Guide complet d'intégration et référence des endpoints</p>

      <div class="quick-links">
        <a href="/admin/api-keys" class="btn-link">
          🔑 Gérer les clés API
        </a>
        <a href="/admin/api-docs#endpoints" class="btn-link secondary">
          📋 Voir tous les endpoints
        </a>
      </div>
    </div>

    <!-- Table of Contents -->
    <nav class="toc">
      <h3>📑 Sommaire</h3>
      <ul>
        <li><a href="#overview">🌟 Aperçu</a></li>
        <li><a href="#auth">🔑 Authentification</a></li>
        <li><a href="#scopes">🔐 Scopes & Permissions</a></li>
        <li><a href="#endpoints">📡 Endpoints</a></li>
        <li><a href="#errors">❌ Codes d'erreur</a></li>
        <li><a href="#examples">💻 Exemples</a></li>
      </ul>
    </nav>

    <!-- Overview -->
    <section class="card highlight" id="overview">
      <h2>🌟 Aperçu</h2>
      <p>MiGallery expose une API REST complète pour gérer albums, utilisateurs, médias et permissions.</p>

      <div class="features-grid">
        <div class="feature">
          <strong>📚 Albums</strong>
          <p>Créer, modifier et supprimer des albums avec métadonnées</p>
        </div>
        <div class="feature">
          <strong>👥 Utilisateurs</strong>
          <p>Gérer les utilisateurs et leurs permissions d'accès</p>
        </div>
        <div class="feature">
          <strong>🖼️ Médias</strong>
          <p>Uploader et organiser des photos/vidéos</p>
        </div>
        <div class="feature">
          <strong>🔐 Sécurité</strong>
          <p>Contrôle d'accès granulaire par scopes</p>
        </div>
      </div>

      <div class="info-box">
        <strong>💡 Démarrage rapide :</strong>
        <ol>
          <li><a href="/admin/api-keys">Créez une clé API</a> avec les scopes appropriés</li>
          <li>Testez vos requêtes avec cURL ou Postman</li>
          <li>Intégrez dans votre application</li>
        </ol>
      </div>
    </section>

    <!-- Authentication -->
    <section class="card" id="auth">
      <h2>🔑 Authentification</h2>
      <p>Deux méthodes d'authentification sont supportées :</p>

      <div class="auth-methods">
        <div class="auth-method">
          <h3>1️⃣ Clé API (Recommandé)</h3>
          <p>Ajoutez le header <code>x-api-key</code> à vos requêtes.</p>
          <pre>curl -H "x-api-key: mg_votre_cle_api" \
  https://gallery.mitv.fr/api/albums</pre>
          <div class="pros">
            ✅ Idéal pour scripts et services externes<br>
            ✅ Pas besoin de cookie ou session<br>
            ✅ Facile à tester avec Postman
          </div>
        </div>

        <div class="auth-method">
          <h3>2️⃣ Cookie de session</h3>
          <p>Automatique quand vous êtes connecté via l'interface web.</p>
          <pre>{'fetch(\'/api/albums\', {\n  credentials: \'include\'\n})'}</pre>
          <div class="info-note">
            ℹ️ Uniquement pour les requêtes depuis le navigateur
          </div>
        </div>
      </div>

      <div class="warning-box">
        <strong>⚠️ Bonnes pratiques :</strong>
        <ul>
          <li>Ne jamais exposer les clés API dans le code client (frontend)</li>
          <li>Révoquer immédiatement toute clé compromise</li>
          <li>Utiliser HTTPS en production</li>
          <li>Rotation régulière des clés pour les services critiques</li>
        </ul>
      </div>

      <div class="info-box">
        <strong>🔒 Endpoints "session only" :</strong>
        <p>Certains endpoints (comme <code>/api/users/me</code>) ne sont accessibles que via session utilisateur, pas via clé API. Ces endpoints gèrent des données personnelles sensibles et nécessitent une authentification utilisateur directe.</p>
      </div>
    </section>

    <!-- Scopes -->
    <section class="card" id="scopes">
      <h2>🔐 Scopes et Permissions</h2>
      <p>Les clés API utilisent des <strong>scopes</strong> pour contrôler l'accès :</p>

      <table class="scopes-table">
        <thead>
          <tr>
            <th>Scope</th>
            <th>Description</th>
            <th>HTTP</th>
            <th>Exemples</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><span class="scope-badge read">read</span></td>
            <td>Lecture seule</td>
            <td><code>GET</code></td>
            <td><code>/api/albums</code>, <code>/api/users/{'{'}id{'}'}/avatar</code></td>
          </tr>
          <tr>
            <td><span class="scope-badge write">write</span></td>
            <td>Création & modification</td>
            <td><code>POST</code>, <code>PATCH</code>, <code>PUT</code></td>
            <td><code>/api/albums</code>, <code>/api/external/media</code></td>
          </tr>
          <tr>
            <td><span class="scope-badge delete">delete</span></td>
            <td>Suppression</td>
            <td><code>DELETE</code></td>
            <td><code>/api/albums/{'{'}id{'}'}</code></td>
          </tr>
          <tr>
            <td><span class="scope-badge admin">admin</span></td>
            <td>Administration complète</td>
            <td>Tous</td>
            <td><code>/api/users</code>, <code>/api/admin/api-keys</code></td>
          </tr>
          <tr>
            <td><span class="scope-badge session">session</span></td>
            <td>Session utilisateur uniquement</td>
            <td>—</td>
            <td><code>/api/users/me</code></td>
          </tr>
        </tbody>
      </table>

      <div class="info-box">
        <strong>💡 Principe du moindre privilège :</strong>
        N'accordez que les scopes nécessaires. Par exemple, une clé pour lire les avatars n'a besoin que de <code>read</code>.
      </div>

      <h4>Scopes cumulatifs</h4>
      <p>Une clé peut avoir plusieurs scopes :</p>
      <pre>{'POST /api/admin/api-keys\n{\n  "label": "Service upload",\n  "scopes": ["read", "write"]\n}'}</pre>
    </section>

    <!-- Endpoints -->
    <section class="card" id="endpoints">
      <h2>📡 Référence des Endpoints</h2>

      {#if endpoints.length > 0}
        {#each endpoints as group}
          <div class="endpoint-group">
            <h3 class="group-title">
              {#if group.group === 'Albums'}📚
              {:else if group.group === 'Users'}👥
              {:else if group.group === 'Assets'}🖼️
              {:else if group.group === 'People & Photos-CV'}📸
              {:else if group.group === 'External uploads'}📤
              {:else if group.group === 'API Keys (Administration)'}🔑
              {:else}📌
              {/if}
              {group.group}
            </h3>
            {#if group.description}
              <p class="group-description">{group.description}</p>
            {/if}

            <div class="endpoints">
              {#each group.items as endpoint}
                <article class="endpoint">
                  <div class="endpoint-top">
                    <div class="endpoint-header">
                      <span class="method {endpoint.method.toLowerCase()}">{endpoint.method}</span>
                      <code class="path">{endpoint.path}</code>
                    </div>
                    {#if endpoint.requiredScopes && endpoint.requiredScopes.length > 0}
                      <div class="required-scopes">
                        {#each endpoint.requiredScopes as scope}
                          <span class="scope-badge {scope}">{scope}</span>
                        {/each}
                      </div>
                    {/if}
                  </div>

                  {#if endpoint.summary}
                    <div class="summary">{endpoint.summary}</div>
                  {/if}

                  {#if endpoint.notes}
                    <div class="notes">📝 {endpoint.notes}</div>
                  {/if}

                  {#if endpoint.params && endpoint.params.length > 0}
                    <div class="params">
                      <strong>Paramètres :</strong>
                      <ul>
                        {#each endpoint.params as param}
                          <li>
                            <code>{param.name}</code>
                            <span class="param-type">({param.in})</span> — {param.desc}
                          </li>
                        {/each}
                      </ul>
                    </div>
                  {/if}

                  {#if endpoint.exampleCurl}
                    <details class="example-details">
                      <summary>📋 Exemple cURL</summary>
                      <pre>{@html esc(endpoint.exampleCurl)}</pre>
                    </details>
                  {/if}

                  {#if endpoint.exampleResponse}
                    <details class="example-details response">
                      <summary>✅ Exemple de réponse</summary>
                      <pre>{@html esc(endpoint.exampleResponse)}</pre>
                    </details>
                  {/if}

                  {#if endpoint.noteAuth}
                    <div class="auth-note">
                      🔒 {endpoint.noteAuth}
                    </div>
                  {/if}
                </article>
              {/each}
            </div>
          </div>
        {/each}
      {/if}
    </section>

    <!-- Error Codes -->
    <section class="card" id="errors">
      <h2>❌ Codes d'erreur</h2>
      <table class="error-table">
        <thead>
          <tr>
            <th>Code</th>
            <th>Signification</th>
            <th>Cause</th>
            <th>Solution</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>400</code></td>
            <td>Bad Request</td>
            <td>Paramètres manquants ou invalides</td>
            <td>Vérifiez la structure de votre requête</td>
          </tr>
          <tr>
            <td><code>401</code></td>
            <td>Unauthorized</td>
            <td>Clé API invalide ou absente</td>
            <td>Ajoutez le header <code>x-api-key</code></td>
          </tr>
          <tr>
            <td><code>403</code></td>
            <td>Forbidden</td>
            <td>Scope insuffisant</td>
            <td>Utilisez une clé avec les scopes requis</td>
          </tr>
          <tr>
            <td><code>404</code></td>
            <td>Not Found</td>
            <td>Ressource inexistante</td>
            <td>Vérifiez l'ID ou le chemin</td>
          </tr>
          <tr>
            <td><code>413</code></td>
            <td>Payload Too Large</td>
            <td>Fichier trop volumineux</td>
            <td>Réduisez la taille (max 500 MB)</td>
          </tr>
          <tr>
            <td><code>500</code></td>
            <td>Internal Server Error</td>
            <td>Erreur serveur</td>
            <td>Contactez l'administrateur</td>
          </tr>
          <tr>
            <td><code>502</code></td>
            <td>Bad Gateway</td>
            <td>Immich API inaccessible</td>
            <td>Vérifiez la connexion à Immich</td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- Examples -->
    <section class="card" id="examples">
      <h2>💻 Exemples d'intégration</h2>

      <div class="example-group">
        <h3>🟨 JavaScript / Node.js</h3>
        <pre><code>const API_KEY = 'votre_cle'
const BASE_URL = 'https://gallery.mitv.fr'

fetch(BASE_URL + '/api/albums', {'{'}
  headers: {'{'}x-api-key: API_KEY{'}'}
{'}'})</code></pre>
      </div>

      <div class="example-group">
        <h3>🐍 Python</h3>
        <pre><code>import requests
headers = {'{'}x-api-key: 'votre_cle'{'}'}
requests.get(
  'https://gallery.mitv.fr/api/albums',
  headers=headers
)</code></pre>
      </div>

      <div class="example-group">
        <h3>💻 cURL</h3>
        <pre><code>curl -H "x-api-key: votre_cle" \
  https://gallery.mitv.fr/api/albums</code></pre>
      </div>
    </section>

    <!-- Help -->
    <section class="card info">
      <h2>💡 Besoin d'aide ?</h2>

      <div class="help-grid">
        <div class="help-item">
          <h4>📚 Documentation complète</h4>
          <ul>
            <li><code>docs/API_SECURITY.md</code> — Sécurité API</li>
            <li><code>docs/API_ENDPOINTS_BY_SCOPE.md</code> — Liste des endpoints par scope</li>
            <li><code>docs/SECURITY_DEV_ROUTES.md</code> — Analyse routes /dev/</li>
            <li><code>tests/README.md</code> — Tests automatisés</li>
          </ul>
        </div>

        <div class="help-item">
          <h4>🔧 Outils recommandés</h4>
          <ul>
            <li><a href="https://curl.se/" target="_blank">cURL</a> — Ligne de commande</li>
            <li><a href="https://httpie.io/" target="_blank">HTTPie</a> — Client HTTP moderne</li>
            <li><a href="https://insomnia.rest/" target="_blank">Insomnia</a> — Tester l'API (GUI)</li>
          </ul>
        </div>

        <div class="help-item">
          <h4>🚀 Démarrage rapide</h4>
          <ol>
            <li><a href="/admin/api-keys">Créez une clé API</a></li>
            <li>Testez avec cURL ou Postman</li>
            <li>Intégrez dans votre app</li>
          </ol>
        </div>
      </div>
    </section>
  </main>
{/if}

<style>
  main {
    max-width: 1200px;
    margin: 0 auto;
    padding: 2rem;
  }

  .header {
    text-align: center;
    margin-bottom: 3rem;
  }

  h1 {
    font-size: 2.5rem;
    font-weight: 700;
    margin: 0 0 0.5rem 0;
    background: linear-gradient(90deg, var(--accent), var(--edit));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .subtitle {
    color: var(--text-muted);
    font-size: 1.125rem;
    margin: 0 0 1.5rem 0;
  }

  .quick-links {
    display: flex;
    gap: 1rem;
    justify-content: center;
    flex-wrap: wrap;
  }

  .btn-link {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1.5rem;
    background: linear-gradient(90deg, var(--accent), var(--edit));
    color: white;
    text-decoration: none;
    border-radius: var(--radius-xs);
    font-weight: 600;
    transition: transform 0.2s;
  }

  .btn-link.secondary {
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid var(--border);
  }

  .btn-link:hover {
    transform: translateY(-2px);
  }

  .toc {
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    padding: 1.5rem;
    border-radius: var(--radius-sm);
    margin-bottom: 2rem;
  }

  .toc h3 {
    margin: 0 0 1rem 0;
    font-size: 1.125rem;
  }

  .toc ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .toc li {
    margin-bottom: 0.5rem;
  }

  .toc a {
    color: var(--text-secondary);
    text-decoration: none;
    transition: color 0.2s;
  }

  .toc a:hover {
    color: var(--accent);
  }

  .card {
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    padding: 2rem;
    border-radius: var(--radius-sm);
    margin-bottom: 2rem;
  }

  .card.highlight {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 3%, transparent);
  }

  .card.info {
    background: color-mix(in srgb, var(--accent) 5%, transparent);
    border-color: color-mix(in srgb, var(--accent) 20%, transparent);
  }

  .card h2 {
    font-size: 1.75rem;
    font-weight: 600;
    margin: 0 0 1.5rem 0;
    padding-bottom: 0.75rem;
    border-bottom: 2px solid var(--border);
  }

  .card h3 {
    font-size: 1.25rem;
    font-weight: 600;
    margin: 1.5rem 0 1rem 0;
  }

  .card h4 {
    font-size: 1rem;
    font-weight: 600;
    margin: 1rem 0 0.5rem 0;
    color: var(--text-secondary);
  }

  .features-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    gap: 1rem;
    margin: 1.5rem 0;
  }

  .feature {
    padding: 1rem;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: var(--radius-xs);
  }

  .feature strong {
    display: block;
    margin-bottom: 0.5rem;
    color: var(--text-primary);
  }

  .feature p {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.875rem;
  }

  .info-box, .warning-box {
    padding: 1rem 1.25rem;
    border-radius: var(--radius-xs);
    margin: 1.5rem 0;
  }

  .info-box {
    background: color-mix(in srgb, var(--accent) 10%, transparent);
    border-left: 4px solid var(--accent);
  }

  .warning-box {
    background: color-mix(in srgb, var(--error) 10%, transparent);
    border-left: 4px solid var(--error);
  }

  .info-box strong, .warning-box strong {
    display: block;
    margin-bottom: 0.5rem;
  }

  .info-box ol, .warning-box ul {
    margin: 0.5rem 0 0 1.5rem;
    padding: 0;
  }

  .auth-methods {
    display: grid;
    gap: 1.5rem;
  }

  .auth-method {
    padding: 1.5rem;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: var(--radius-xs);
  }

  .auth-method h3 {
    margin-top: 0;
  }

  .pros {
    margin-top: 1rem;
    padding: 0.75rem;
    background: color-mix(in srgb, var(--success) 10%, transparent);
    border-radius: 4px;
    color: var(--text-secondary);
    font-size: 0.875rem;
    line-height: 1.6;
  }

  .info-note {
    margin-top: 1rem;
    padding: 0.75rem;
    background: color-mix(in srgb, var(--accent) 10%, transparent);
    border-radius: 4px;
    color: var(--text-secondary);
    font-size: 0.875rem;
  }

  .scopes-table, .error-table {
    width: 100%;
    border-collapse: collapse;
    margin: 1.5rem 0;
  }

  .scopes-table th, .error-table th {
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    padding: 0.75rem;
    text-align: left;
    font-weight: 600;
    font-size: 0.875rem;
  }

  .scopes-table td, .error-table td {
    border: 1px solid var(--border);
    padding: 0.75rem;
    vertical-align: top;
  }

  .scopes-table tr:nth-child(even), .error-table tr:nth-child(even) {
    background: var(--bg-secondary);
  }

  .scope-badge {
    display: inline-block;
    padding: 0.25rem 0.75rem;
    border-radius: var(--radius-md);
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .scope-badge.read {
    background: color-mix(in srgb, var(--accent) 20%, transparent);
    color: var(--accent);
  }

  .scope-badge.write {
    background: color-mix(in srgb, var(--success) 20%, transparent);
    color: var(--success);
  }

  .scope-badge.delete {
    background: color-mix(in srgb, var(--error) 20%, transparent);
    color: var(--error);
  }

  .scope-badge.admin {
    background: color-mix(in srgb, var(--purple) 20%, transparent);
    color: var(--purple);
  }

  .scope-badge.session {
    background: rgba(251, 191, 36, 0.2);
    color: var(--warning);
  }

  .endpoint-group {
    margin-bottom: 2.5rem;
  }

  .group-title {
    font-size: 1.5rem;
    margin-bottom: 0.5rem;
    padding-bottom: 0.5rem;
    border-bottom: 2px solid var(--border);
  }

  .group-description {
    color: var(--text-muted);
    margin-bottom: 1.5rem;
  }

  .endpoints {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .endpoint {
    padding: 1.25rem;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: var(--radius-xs);
    transition: border-color 0.2s;
  }

  .endpoint:hover {
    border-color: var(--accent);
  }

  .endpoint-top {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 1rem;
    margin-bottom: 0.75rem;
    flex-wrap: wrap;
  }

  .endpoint-header {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .method {
    padding: 0.375rem 0.75rem;
    border-radius: 4px;
    font-weight: 700;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .method.get {
    background: color-mix(in srgb, var(--accent) 20%, transparent);
    color: var(--accent);
  }

  .method.post {
    background: color-mix(in srgb, var(--success) 20%, transparent);
    color: var(--success);
  }

  .method.patch, .method.put {
    background: color-mix(in srgb, var(--warning) 20%, transparent);
    color: var(--warning);
  }

  .method.delete {
    background: color-mix(in srgb, var(--error) 20%, transparent);
    color: var(--error);
  }

  .path {
    font-family: 'Courier New', monospace;
    font-weight: 500;
    color: var(--accent);
  }

  .required-scopes {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .summary {
    color: var(--text-secondary);
    margin-bottom: 0.75rem;
  }

  .notes {
    color: var(--text-muted);
    font-size: 0.875rem;
    margin-bottom: 0.75rem;
    padding: 0.5rem 0.75rem;
    background: color-mix(in srgb, var(--accent) 5%, transparent);
    border-left: 2px solid var(--accent);
    border-radius: 4px;
  }

  .params {
    margin: 0.75rem 0;
    padding: 0.75rem;
    background: var(--bg-primary);
    border-radius: 4px;
  }

  .params ul {
    margin: 0.5rem 0 0 1.5rem;
    padding: 0;
  }

  .params li {
    margin-bottom: 0.25rem;
    font-size: 0.875rem;
  }

  .param-type {
    color: var(--text-muted);
    font-size: 0.75rem;
  }

  .example-details {
    margin-top: 0.75rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    overflow: hidden;
  }

  .example-details summary {
    padding: 0.75rem;
    background: var(--bg-primary);
    cursor: pointer;
    font-weight: 600;
    font-size: 0.875rem;
    user-select: none;
  }

  .example-details summary:hover {
    background: rgba(255, 255, 255, 0.05);
  }

  .example-details pre {
    margin: 0;
    border-top: 1px solid var(--border);
  }

  .example-details.response {
    border-color: color-mix(in srgb, var(--success) 30%, transparent);
  }

  .example-details.response summary {
    background: color-mix(in srgb, var(--success) 5%, transparent);
    color: var(--success);
  }

  .example-details.response summary:hover {
    background: color-mix(in srgb, var(--success) 10%, transparent);
  }

  .auth-note {
    margin-top: 0.75rem;
    padding: 0.5rem 0.75rem;
    background: color-mix(in srgb, var(--purple) 10%, transparent);
    border-left: 2px solid var(--purple);
    border-radius: 4px;
    font-size: 0.875rem;
    color: var(--text-secondary);
  }

  .example-group {
    margin-bottom: 2rem;
  }

  .example-group h3 {
    margin-top: 0;
  }

  pre {
    background: var(--bg-primary);
    padding: 1rem;
    border-radius: var(--radius-xs);
    overflow-x: auto;
    border: 1px solid var(--border);
    font-size: 0.875rem;
    line-height: 1.6;
    font-family: 'Courier New', monospace;
  }

  code {
    background: var(--bg-primary);
    padding: 0.2rem 0.4rem;
    border-radius: 3px;
    font-family: 'Courier New', monospace;
    font-size: 0.875em;
    color: var(--accent);
  }

  .help-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 1.5rem;
    margin-top: 1.5rem;
  }

  .help-item {
    padding: 1.25rem;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: var(--radius-xs);
  }

  .help-item h4 {
    margin-top: 0;
  }

  .help-item ul {
    margin: 0;
    padding-left: 1.5rem;
  }

  .help-item li {
    margin-bottom: 0.5rem;
  }

  .help-item ol {
    margin: 0;
    padding-left: 1.5rem;
  }

  .help-item a {
    color: var(--accent);
    text-decoration: none;
  }

  .help-item a:hover {
    text-decoration: underline;
  }

  @media (max-width: 768px) {
    main {
      padding: 1rem;
    }

    h1 {
      font-size: 2rem;
    }

    .features-grid {
      grid-template-columns: 1fr;
    }

    .endpoint-top {
      flex-direction: column;
      align-items: flex-start;
    }
  }
</style>
