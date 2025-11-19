<script lang="ts">
  import { page } from '$app/state';
  const endpoints = (page as any).data?.endpoints || [];
  function esc(s: string) { return s.replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  let isAdmin = $derived((page.data.session?.user as any)?.role === 'admin');
</script>

<svelte:head>
  <title>Admin — Documentation API</title>
</svelte:head>

{#if !isAdmin}
  <p>Accès réservé aux administrateurs.</p>
{:else}
  <main>
    <h1>Documentation API</h1>
    <p class="subtitle">Intégration et utilisation de l'API MiGallery</p>

    <!-- Authentication Section -->
    <section class="card">
      <h2>🔑 Authentification</h2>
      <p>L'API supporte deux méthodes d'authentification :</p>
      <ul>
        <li><strong>Clés API :</strong> Créez une clé dans <a href="/admin/api-keys">Gestion des clés API</a> et incluez-la dans l'en-tête <code>X-API-Key</code></li>
        <li><strong>Cookie de session :</strong> Pour les requêtes navigateur authentifiées (admin uniquement)</li>
      </ul>
      <pre>curl -H "X-API-Key: YOUR_API_KEY" https://migallery.example.com/api/...</pre>
    </section>

    <!-- PortailEtu Album API -->
    <section class="card highlight">
      <h2>📚 API Album PortailEtu</h2>
      <p>L'album <strong>PortailEtu</strong> est un stockage système pour les médias du portail étudiant. Il est accessible via une API dédiée pour importer, récupérer et gérer les fichiers.</p>

      <!-- Upload Media -->
      <div class="api-endpoint">
        <div class="endpoint-header">
          <span class="method post">POST</span>
          <code>/api/albums/PortailEtu/media</code>
        </div>
        <p>Importe un fichier dans l'album PortailEtu.</p>
        <h4>Paramètres</h4>
        <table class="api-table">
          <thead><tr><th>Paramètre</th><th>Type</th><th>Description</th></tr></thead>
          <tbody>
            <tr><td><code>file</code></td><td>FormData</td><td>Fichier image/vidéo (max 500 MB)</td></tr>
            <tr><td><code>metadata</code></td><td>JSON</td><td>Optionnel : <code>{'{"title": "...", "description": "..."}'}</code></td></tr>
          </tbody>
        </table>
        <div class="example-label">Exemple</div>
        <pre>curl -X POST -H "X-API-Key: YOUR_KEY" \
  -F "file=@photo.jpg" \
  -F 'metadata={{"title": "Photo"}}' \
  https://migallery.example.com/api/albums/PortailEtu/media</pre>
      </div>

      <!-- Get Media List -->
      <div class="api-endpoint">
        <div class="endpoint-header">
          <span class="method get">GET</span>
          <code>/api/albums/PortailEtu/media</code>
        </div>
        <p>Liste les médias de l'album PortailEtu avec pagination.</p>
        <h4>Paramètres de requête</h4>
        <table class="api-table">
          <thead><tr><th>Paramètre</th><th>Type</th><th>Description</th></tr></thead>
          <tbody>
            <tr><td><code>limit</code></td><td>Entier</td><td>Max résultats (défaut: 50, max: 100)</td></tr>
            <tr><td><code>offset</code></td><td>Entier</td><td>Décalage pagination (défaut: 0)</td></tr>
            <tr><td><code>sort</code></td><td>String</td><td>Tri : created_asc | created_desc (défaut: created_desc)</td></tr>
          </tbody>
        </table>
        <div class="example-label">Exemple</div>
        <pre>curl -H "X-API-Key: YOUR_KEY" \
  'https://migallery.example.com/api/albums/PortailEtu/media?limit=20'</pre>
      </div>

      <!-- Get Single Media -->
      <div class="api-endpoint">
        <div class="endpoint-header">
          <span class="method get">GET</span>
          <code>/api/albums/PortailEtu/media/:media_id</code>
        </div>
        <p>Récupère les détails d'un média spécifique.</p>
        <div class="example-label">Exemple</div>
        <pre>curl -H "X-API-Key: YOUR_KEY" \
  https://migallery.example.com/api/albums/PortailEtu/media/uuid-xxx</pre>
      </div>

      <!-- Delete Single Media -->
      <div class="api-endpoint">
        <div class="endpoint-header">
          <span class="method delete">DELETE</span>
          <code>/api/albums/PortailEtu/media/:media_id</code>
        </div>
        <p>Supprime un média de l'album PortailEtu. <strong>Action irréversible.</strong></p>
        <div class="example-label">Exemple</div>
        <pre>curl -X DELETE -H "X-API-Key: YOUR_KEY" \
  https://migallery.example.com/api/albums/PortailEtu/media/uuid-xxx</pre>
      </div>

      <!-- Delete All Media -->
      <div class="api-endpoint">
        <div class="endpoint-header">
          <span class="method delete">DELETE</span>
          <code>/api/albums/PortailEtu/media</code>
        </div>
        <p><strong>⚠️ Supprime tous les médias de PortailEtu.</strong> Requiert une confirmation explicite.</p>
        <h4>Corps de la requête</h4>
        <pre>{{ "confirm": true, "reason": "Nettoyage annuel" }}</pre>
        <div class="example-label">Exemple</div>
        <pre>curl -X DELETE -H "X-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{{"confirm": true}}' \
  https://migallery.example.com/api/albums/PortailEtu/media</pre>
      </div>
    </section>

    <!-- Scopes Section -->
    <section class="card">
      <h2>🔐 Scopes et Permissions</h2>
      <p>Les clés API peuvent être restreintes par scopes :</p>
      <ul>
        <li><code>read</code> — Lecture seule (GET)</li>
        <li><code>write</code> — Écriture (POST)</li>
        <li><code>delete</code> — Suppression (DELETE)</li>
        <li><code>admin</code> — Accès complet</li>
      </ul>
      <p><strong>Exemple :</strong> Une clé avec scopes <code>read,write</code> permet les uploads et lectures, mais pas les suppressions.</p>
    </section>

    <!-- Error Codes -->
    <section class="card">
      <h2>❌ Codes d'erreur</h2>
      <table class="api-table">
        <thead><tr><th>Code</th><th>Description</th></tr></thead>
        <tbody>
          <tr><td><code>400</code></td><td>Requête malformée (paramètres manquants)</td></tr>
          <tr><td><code>401</code></td><td>Non authentifié (clé API invalide)</td></tr>
          <tr><td><code>403</code></td><td>Accès refusé (scope insuffisant)</td></tr>
          <tr><td><code>404</code></td><td>Ressource non trouvée</td></tr>
          <tr><td><code>413</code></td><td>Fichier trop volumineux</td></tr>
          <tr><td><code>500</code></td><td>Erreur serveur</td></tr>
        </tbody>
      </table>
    </section>

    <!-- Existing Endpoints from Server -->
    {#if endpoints.length > 0}
      <section class="card">
        <h2>📡 Endpoints supplémentaires</h2>
        {#each endpoints as group}
          <div class="endpoint-group" id={group.group}>
            <h3>{group.group}</h3>
            {#if group.description}
              <p class="muted">{group.description}</p>
            {/if}
            <div class="endpoints">
              {#each group.items as it}
                <article class="endpoint">
                  <div class="endpoint-header">
                    <span class="method">{it.method}</span>
                    <code class="path">{it.path}</code>
                  </div>
                  {#if it.summary}
                    <div class="summary">{it.summary}</div>
                  {/if}
                  {#if it.params}
                    <div class="params"><strong>Params:</strong>
                      <ul>
                        {#each it.params as p}
                          <li><strong>{p.name}</strong> — {p.desc}</li>
                        {/each}
                      </ul>
                    </div>
                  {/if}
                  {#if it.exampleCurl}
                    <div class="example">
                      <div class="example-label">Exemple curl</div>
                      <pre>{@html esc(it.exampleCurl)}</pre>
                    </div>
                  {/if}
                  {#if it.noteAuth}
                    <div class="note">{it.noteAuth}</div>
                  {/if}
                </article>
              {/each}
            </div>
          </div>
        {/each}
      </section>
    {/if}

    <!-- Integration Examples -->
    <section class="card">
      <h2>💻 Exemples d'intégration</h2>
      
      <h3>JavaScript / Node.js</h3>
      <pre>{@html `const apiKey = 'YOUR_API_KEY';

// Importer un fichier
async function uploadMedia(file) {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch('/api/albums/PortailEtu/media', {
    method: 'POST',
    headers: {'X-API-Key': apiKey},
    body: form
  });
  return await res.json();
}

// Récupérer les médias
async function getMedia() {
  const res = await fetch('/api/albums/PortailEtu/media', {
    headers: {'X-API-Key': apiKey}
  });
  return await res.json();
}`.replace(/'/g, '&#39;')}</pre>

      <h3>Python</h3>
      <pre>{@html `import requests

API_KEY = 'YOUR_API_KEY'

# Importer
with open('photo.jpg', 'rb') as f:
  files = {'file': f}
  headers = {'X-API-Key': API_KEY}
  r = requests.post('/api/albums/PortailEtu/media', files=files, headers=headers)
  print(r.json())

# Récupérer
headers = {'X-API-Key': API_KEY}
r = requests.get('/api/albums/PortailEtu/media', headers=headers)
print(r.json())`.replace(/'/g, '&#39;')}</pre>
    </section>

    <!-- Help -->
    <section class="card info">
      <h3>💡 Besoin d'aide ?</h3>
      <p>Utilisez <a href="https://www.postman.com/" target="_blank">Postman</a> pour tester l'API ou <a href="https://curl.se/" target="_blank">curl</a> en ligne de commande.</p>
      <p>Créez une clé API sur <a href="/admin/api-keys">cette page</a> pour commencer.</p>
    </section>
  </main>
{/if}

<style>
  main { display: block; }
  
  h1 {
    font-size: 2rem;
    font-weight: 700;
    margin: 0 0 0.5rem 0;
  }

  .subtitle {
    color: var(--text-muted);
    font-size: 0.9375rem;
    margin: 0 0 1.5rem 0;
  }
  
  .card { 
    background: var(--bg-tertiary); 
    border: 1px solid var(--border); 
    padding: 1.5rem; 
    border-radius: var(--radius-sm); 
    margin-bottom: 1.5rem;
  }

  .card.highlight {
    border-color: var(--accent);
    background: rgba(59, 130, 246, 0.02);
  }

  .card.info {
    background: rgba(59, 130, 246, 0.05);
    border-color: rgba(59, 130, 246, 0.2);
  }
  
  .card h2 {
    font-size: 1.5rem;
    font-weight: 600;
    margin: 0 0 1rem 0;
    color: var(--text-primary);
    padding-bottom: 0.5rem;
    border-bottom: 2px solid var(--border);
  }

  .card h3 {
    font-size: 1.125rem;
    font-weight: 600;
    margin: 1.5rem 0 0.75rem 0;
    color: var(--text-primary);
  }

  .card h4 {
    font-size: 0.875rem;
    font-weight: 600;
    margin: 1rem 0 0.5rem 0;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  
  .card > p, .card > ul {
    color: var(--text-secondary);
    line-height: 1.6;
    margin: 0.5rem 0 1rem 0;
  }

  .card ul {
    list-style: disc;
    padding-left: 1.5rem;
  }

  .card ul li {
    margin-bottom: 0.5rem;
  }
  
  .card a {
    color: var(--accent);
    text-decoration: none;
    font-weight: 500;
  }
  
  .card a:hover {
    text-decoration: underline;
  }
  
  .muted {
    color: var(--text-muted);
    font-size: 0.9375rem;
  }

  .api-endpoint {
    padding: 1rem;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: var(--radius-xs);
    margin-bottom: 1rem;
  }

  .endpoint-header {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 0.75rem;
    font-family: 'Courier New', monospace;
  }

  .method {
    display: inline-block;
    padding: 0.3rem 0.6rem;
    border-radius: 4px;
    font-weight: 700;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    white-space: nowrap;
  }

  .method.post {
    background: rgba(34, 197, 94, 0.2);
    color: #22c55e;
  }

  .method.get {
    background: rgba(59, 130, 246, 0.2);
    color: #3b82f6;
  }

  .method.delete {
    background: rgba(239, 68, 68, 0.2);
    color: #ef4444;
  }

  code {
    background: var(--bg-primary);
    padding: 0.2rem 0.4rem;
    border-radius: 3px;
    font-family: 'Courier New', monospace;
    font-size: 0.9em;
    color: var(--accent);
  }

  .path {
    font-weight: 500;
    color: var(--accent);
    background: transparent;
    padding: 0;
  }

  .summary {
    color: var(--text-secondary);
    font-size: 0.9375rem;
    margin-top: 0.5rem;
  }

  .params {
    margin: 0.75rem 0;
    padding: 0.75rem;
    background: var(--bg-primary);
    border-radius: var(--radius-xs);
    border: 1px solid var(--border);
  }
  
  .params strong {
    color: var(--text-primary);
  }
  
  .params ul { 
    margin: 0.5rem 0 0 1.5rem;
    color: var(--text-secondary);
  }
  
  .params li {
    margin-bottom: 0.25rem;
  }
  
  .example {
    margin-top: 0.75rem;
  }
  
  .example-label { 
    font-weight: 600;
    margin-bottom: 0.5rem;
    color: var(--text-primary);
    font-size: 0.875rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  
  pre { 
    background: var(--bg-primary); 
    padding: 1rem; 
    border-radius: var(--radius-xs); 
    overflow-x: auto;
    border: 1px solid var(--border);
    font-size: 0.875rem;
    line-height: 1.5;
    color: var(--text-secondary);
    font-family: 'Courier New', monospace;
  }
  
  .note { 
    margin-top: 0.75rem;
    padding: 0.625rem 0.875rem;
    background: rgba(59, 130, 246, 0.1);
    border-left: 3px solid var(--accent);
    border-radius: 4px;
    color: var(--text-secondary);
    font-size: 0.875rem;
  }

  .api-table {
    width: 100%;
    border-collapse: collapse;
    margin: 1rem 0;
  }

  .api-table th {
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    padding: 0.75rem;
    text-align: left;
    font-weight: 600;
    font-size: 0.875rem;
    color: var(--text-muted);
    vertical-align: middle;
  }

  .api-table td {
    border: 1px solid var(--border);
    padding: 0.75rem;
    color: var(--text-secondary);
    vertical-align: middle;
  }

  .api-table tr:nth-child(even) {
    background: var(--bg-secondary);
  }

  .endpoints {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .endpoint {
    padding: 1rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-xs);
    background: var(--bg-secondary);
  }

  .endpoint:hover {
    border-color: var(--accent);
  }

  .endpoint-group {
    margin-bottom: 1.5rem;
  }

  .endpoint-group h3 {
    border-bottom: 2px solid var(--border);
    padding-bottom: 0.5rem;
  }
</style>
