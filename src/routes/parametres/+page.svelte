<script lang="ts">
  import { page } from "$app/state";

  let uploadStatus = $state<string>("");
  let assetId = $state<string | null>(null);
  let personId = $state<string | null>(null);

  let isProcessing = $state<boolean>(false);
  let canRetry = $state<boolean>(false);
  let needsNewPhoto = $state<boolean>(false);

  // État pour la gestion de la BDD et de l'utilisateur
  let allUsers = $state<any[]>([]);
  let editingUserId = $state<string | null>(null);
  let editingUserData = $state({ id_user: '', email: '', prenom: '', nom: '', id_photos: '', role: 'user', promo_year: null });
  let currentUserId = $state<string>("");
  let newUserData = $state({
    id_user: "",
    email: "",
    prenom: "",
    nom: "",
    id_photos: ""
  });
  let showDbManager = $state<boolean>(false);

  async function loadAllUsers() {
    const response = await fetch('/api/db', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sql: "SELECT * FROM users"
      })
    });

    const result = await response.json();
    if (result.success) {
      allUsers = result.data;
    }
  }

  async function addUser() {
    if (!newUserData.id_user || !newUserData.email || !newUserData.prenom || !newUserData.nom) {
      alert("Les champs id_user, email, prenom et nom sont requis !");
      return;
    }

    const response = await fetch('/api/db', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sql: "INSERT INTO users (id_user, email, prenom, nom, id_photos, first_login) VALUES (?, ?, ?, ?, ?, ?)",
        params: [newUserData.id_user, newUserData.email, newUserData.prenom, newUserData.nom, newUserData.id_photos || null, newUserData.id_photos ? 0 : 1]
      })
    });

    const result = await response.json();
    if (result.success) {
      alert("Utilisateur ajouté avec succès !");
      newUserData = { id_user: "", email: "", prenom: "", nom: "", id_photos: "" };
      await loadAllUsers();
    } else {
      alert(`Erreur: ${result.error}`);
    }
  }

  async function startEditUser(user: any) {
    editingUserId = user.id_user;
    editingUserData = { id_user: user.id_user, email: user.email, prenom: user.prenom, nom: user.nom, id_photos: user.id_photos || '', role: user.role || 'user', promo_year: user.promo_year };
  }

  function cancelEditUser() {
    editingUserId = null;
  }

  async function saveUserEdit() {
    if (!editingUserId) return;
    const res = await fetch('/api/db', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql: 'UPDATE users SET email = ?, prenom = ?, nom = ?, id_photos = ?, role = ?, promo_year = ? WHERE id_user = ?', params: [editingUserData.email, editingUserData.prenom, editingUserData.nom, editingUserData.id_photos || null, editingUserData.role || 'user', editingUserData.promo_year || null, editingUserId] })
    });
    const j = await res.json();
    if (j.success) {
      editingUserId = null;
      await loadAllUsers();
    } else {
      alert('Erreur mise à jour utilisateur: ' + (j.error || 'unknown'));
    }
  }

  async function deleteUser(id_user: string) {
    if (!confirm('Supprimer cet utilisateur ? Cette action est irréversible.')) return;
    await fetch('/api/db', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sql: 'DELETE FROM users WHERE id_user = ?', params: [id_user] }) });
    await loadAllUsers();
  }

  async function changeCurrentUser() {
    if (!currentUserId) {
      alert("Veuillez entrer un ID utilisateur");
      return;
    }

    const response = await fetch('/api/change-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUserId })
    });
      if (response.ok) {
        alert("Utilisateur changé ! Rechargement de la page...");
        window.location.reload();
      } else {
        alert("Erreur lors du changement d'utilisateur");
      }

  }

  // ===== Albums management state & helpers =====
  let albums: any[] = $state<any[]>([]);
  let showAlbumManager = $state<boolean>(false);
  let editingAlbumId = $state<string | null>(null);
  let editingAlbumData = $state({ id: '', name: '', date: '', location: '', visibility: 'private', visible: false, tags: '', allowed_users: '' });
  let editingAlbumExistingTags = $state<string[]>([]);
  let editingAlbumExistingUsers = $state<string[]>([]);

  async function loadAlbums() {
    const res = await fetch('/api/db', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      // order by date (newest first) then by name
      body: JSON.stringify({ sql: "SELECT * FROM albums ORDER BY date DESC, name ASC" })
    });
    const json = await res.json();
    if (json.success) albums = json.data;
  }

  // No manual album creation: albums are sourced from Immich. Use import button to sync.

  async function startEditAlbum(a: any) {
    editingAlbumId = a.id;
    // load tags and allowed users
    const tagsRes = await fetch('/api/db', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sql: 'SELECT tag FROM album_tag_permissions WHERE album_id = ?', params: [a.id] }) });
    const tagsJson = await tagsRes.json();
    const tagsArr = tagsJson.success ? (tagsJson.data || []).map((r: any) => r.tag) : [];
    const tags = tagsArr.join(', ');

    const usersRes = await fetch('/api/db', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sql: 'SELECT id_user FROM album_user_permissions WHERE album_id = ?', params: [a.id] }) });
    const usersJson = await usersRes.json();
    const usersArr = usersJson.success ? (usersJson.data || []).map((r: any) => r.id_user) : [];
    const users = usersArr.join(', ');

    editingAlbumExistingTags = tagsArr;
    editingAlbumExistingUsers = usersArr;

  editingAlbumData = { id: a.id, name: a.name, date: a.date || '', location: a.location || '', visibility: a.visibility || 'private', visible: a.visible === 1, tags, allowed_users: users };
  }

  function cancelEditAlbum() {
    editingAlbumId = null;
  }

  async function saveAlbumEdit() {
    if (!editingAlbumId) return;
    const id = editingAlbumId;
    // update main album
  await fetch('/api/db', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sql: 'UPDATE albums SET name = ?, date = ?, location = ?, visibility = ?, visible = ? WHERE id = ?', params: [editingAlbumData.name, editingAlbumData.date || null, editingAlbumData.location || null, editingAlbumData.visibility || 'private', editingAlbumData.visible ? 1 : 0, id] }) });

    // compute diffs for tags
    const desiredTags = editingAlbumData.tags ? editingAlbumData.tags.split(',').map((t: string) => t.trim()).filter(Boolean) : [];
    const toAddTags = desiredTags.filter(t => !editingAlbumExistingTags.includes(t));
    const toRemoveTags = editingAlbumExistingTags.filter(t => !desiredTags.includes(t));

    for (const t of toAddTags) {
      await fetch('/api/db', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sql: 'INSERT OR IGNORE INTO album_tag_permissions (album_id, tag) VALUES (?, ?)', params: [id, t] }) });
    }
    for (const t of toRemoveTags) {
      await fetch('/api/db', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sql: 'DELETE FROM album_tag_permissions WHERE album_id = ? AND tag = ?', params: [id, t] }) });
    }

    // compute diffs for allowed users
    const desiredUsers = editingAlbumData.allowed_users ? editingAlbumData.allowed_users.split(',').map((u: string) => u.trim()).filter(Boolean) : [];
    const toAddUsers = desiredUsers.filter(u => !editingAlbumExistingUsers.includes(u));
    const toRemoveUsers = editingAlbumExistingUsers.filter(u => !desiredUsers.includes(u));

    for (const u of toAddUsers) {
      await fetch('/api/db', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sql: 'INSERT OR IGNORE INTO album_user_permissions (album_id, id_user) VALUES (?, ?)', params: [id, u] }) });
    }
    for (const u of toRemoveUsers) {
      await fetch('/api/db', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sql: 'DELETE FROM album_user_permissions WHERE album_id = ? AND id_user = ?', params: [id, u] }) });
    }

    // refresh local state
    editingAlbumExistingTags = desiredTags;
    editingAlbumExistingUsers = desiredUsers;

    editingAlbumId = null;
    await loadAlbums();
  }

  async function deleteAlbum(albumId: string) {
    if (!confirm('Supprimer cet album ? Cette action est irréversible.')) return;
    await fetch('/api/db', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sql: 'DELETE FROM albums WHERE id = ?', params: [albumId] }) });
    // cascade should remove permissions thanks to foreign key with ON DELETE CASCADE
    await loadAlbums();
  }

  $effect(() => {
    if (showAlbumManager) loadAlbums();
  });

  // Charger les utilisateurs quand on ouvre le gestionnaire DB
  $effect(() => {
    if (showDbManager) loadAllUsers();
  });

  // Importer les albums depuis Immich via le proxy serveur
  async function importAlbumsFromImmich() {
    try {
      const res = await fetch('/api/immich/albums');
      if (!res.ok) {
        alert(`Erreur récupération albums Immich: ${res.status} ${res.statusText}`);
        return;
      }
      const list = await res.json();
      if (!Array.isArray(list)) {
        alert('Réponse Immich inattendue');
        return;
      }

      let added = 0;
        for (const a of list) {
        const immichId = a.id || a.albumId || a.album_id || a._id || null;
        if (!immichId) continue;
        let name = a.name || a.title || a.albumName || String(immichId || '');
        let dateVal = null;
        const m = name.match(/^([0-9]{4}-[0-9]{2}-[0-9]{2})\s*(.*)$/);
        if (m) {
          dateVal = m[1];
          name = m[2] || name;
        }
        // Use the DB proxy endpoint to insert (id = immich UUID)
        await fetch('/api/db', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sql: 'INSERT OR IGNORE INTO albums (id, name, date, location, visibility, visible) VALUES (?, ?, ?, ?, ?, ?)', params: [immichId, name, dateVal, null, 'private', 1] })
        });
        added++;
      }

      alert(`Import terminé : ${added} albums importés (visibilité=private)`);
      await loadAlbums();
    } catch (err) {
      console.error('Import albums error', err);
      alert('Erreur lors de l\'import des albums. Voir la console.');
    }
  }

  async function retryRecognition() {
    if (!assetId) return;
    
    canRetry = false;
    isProcessing = true;
    uploadStatus = "Nouvelle tentative de reconnaissance...";
    
    await checkForPeople();
    
    isProcessing = false;
  }

  async function checkForPeople() {
    const userId = (page.data.session?.user as any)?.id_user;
    
    if (!userId || !assetId) return;

    try {
      uploadStatus = "Récupération des personnes détectées...";
      const assetInfoResponse = await fetch(`/api/immich/assets/${assetId}`);
      
      if (!assetInfoResponse.ok) {
        throw new Error(`Erreur récupération asset: ${assetInfoResponse.statusText}`);
      }

      const assetInfo = await assetInfoResponse.json();
      const people = assetInfo.people || [];

      uploadStatus = `${people.length} personne(s) détectée(s)`;

      if (people.length === 1) {
        personId = people[0].id;
        uploadStatus = `Une personne détectée ! ID: ${personId}`;

        const updateResponse = await fetch('/api/db', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sql: "UPDATE users SET id_photos = ?, first_login = 0 WHERE id_user = ?",
            params: [personId, userId]
          })
        });

        const updateResult = await updateResponse.json();
        
        if (updateResult.success) {
          uploadStatus = `✅ Terminé ! id_photos = ${personId}`;
          alert("Photo de profil configurée ! Rechargement de la page...");
          window.location.reload();
        } else {
          uploadStatus = `⚠️ Personne détectée mais erreur mise à jour BDD: ${updateResult.error}`;
        }
      } else if (people.length === 0) {
        uploadStatus = "❌ Aucune personne détectée sur cette photo.";
        canRetry = true;
      } else {
        uploadStatus = `❌ Plusieurs personnes détectées (${people.length}). Veuillez choisir une photo avec une seule personne.`;
        needsNewPhoto = true;
      }
    } catch (error) {
      uploadStatus = `❌ Erreur: ${error instanceof Error ? error.message : 'Erreur inconnue'}`;
      console.error("Erreur lors de la vérification des personnes:", error);
    }
  }

  async function importPhoto(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    
    if (!file) return;

    const userId = (page.data.session?.user as any)?.id_user;
    
    if (!userId) {
      alert("Pas d'utilisateur connecté");
      return;
    }

    isProcessing = true;
    uploadStatus = "Upload en cours...";
    assetId = null;
    personId = null;
    canRetry = false;
    needsNewPhoto = false;

    try {
      const formData = new FormData();
      formData.append('assetData', file);
      formData.append('deviceAssetId', `${file.name}-${Date.now()}`);
      formData.append('deviceId', 'MiGallery-Web');
      formData.append('fileCreatedAt', new Date().toISOString());
      formData.append('fileModifiedAt', new Date().toISOString());

      uploadStatus = "Upload de la photo...";
      const uploadResponse = await fetch('/api/immich/assets', {
        method: 'POST',
        body: formData
      });

      if (!uploadResponse.ok) {
        throw new Error(`Erreur upload: ${uploadResponse.statusText}`);
      }

      const uploadResult = await uploadResponse.json();
      assetId = uploadResult.id;
      uploadStatus = `Photo uploadée ! ID: ${assetId}`;

      uploadStatus = "Analyse en cours (attente 8 secondes)...";
      await new Promise(resolve => setTimeout(resolve, 8000));

      await checkForPeople();

    } catch (error) {
      uploadStatus = `❌ Erreur: ${error instanceof Error ? error.message : 'Erreur inconnue'}`;
      console.error("Erreur import photo:", error);
    } finally {
      isProcessing = false;
      input.value = '';
    }
  }
</script>

<svelte:head>
  <title>Paramètres - MiGallery</title>
  <style>
    * {
      box-sizing: border-box;
    }
  </style>
</svelte:head>

<style>
  main {
    max-width: 1400px;
    margin: 0 auto;
    padding: 20px;
  }

  /* nav link removed from template; styles omitted */

  h1 {
    color: #2c3e50;
    margin-bottom: 30px;
  }

  h2 {
    color: #2c3e50;
    margin-top: 40px;
    margin-bottom: 20px;
  }

  .section {
    background: white;
    padding: 25px;
    border-radius: 12px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    margin-bottom: 30px;
  }

  .user-section {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 20px;
    border-radius: 12px;
    margin-bottom: 30px;
    box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
  }

  .user-section h3 {
    margin-top: 0;
  }

  .user-section p {
    margin: 8px 0;
  }

  .user-section input {
    margin-left: 10px;
    padding: 8px 12px;
    border: none;
    border-radius: 6px;
    width: 220px;
  }

  .user-section button {
    margin-left: 10px;
    padding: 8px 16px;
    background: white;
    color: #667eea;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-weight: bold;
    transition: transform 0.2s;
  }

  .user-section button:hover {
    transform: scale(1.05);
  }

  button {
    padding: 10px 20px;
    background: #3498db;
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 1em;
    transition: background 0.2s;
  }
  button:hover {
    background: #2980b9;
  }

  button:disabled {
    background: #95a5a6;
    cursor: not-allowed;
  }

  .status-box {
    padding: 15px;
    margin: 15px 0;
    background: #f0f0f0;
    border-radius: 8px;
    border-left: 4px solid #3498db;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    margin: 20px 0;
  }

  th, td {
    border: 1px solid #ddd;
    padding: 12px;
    text-align: left;
  }

  th {
    background: #f0f0f0;
    font-weight: bold;
  }

  .form-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 15px;
    max-width: 600px;
    margin: 20px 0;
  }

  .form-grid label {
    display: block;
    margin-bottom: 5px;
    font-weight: 500;
  }

  .form-grid input {
    width: 100%;
    padding: 8px;
    border: 1px solid #ddd;
    border-radius: 6px;
  }

  .full-width {
    grid-column: 1 / -1;
  }

  .success-button {
    background: #4CAF50;
  }

  .success-button:hover {
    background: #45a049;
  }
</style>

<main>
  <h1>⚙️ Paramètres</h1>

  <!-- Utilisateur actuel -->
  <div class="user-section">
    <h3>👤 Utilisateur actuel</h3>
    <p><strong>ID:</strong> {(page.data.session?.user as any)?.id_user || "Non connecté"}</p>
    <p><strong>Nom:</strong> {(page.data.session?.user as any)?.prenom} {(page.data.session?.user as any)?.nom}</p>
    <p><strong>Email:</strong> {page.data.session?.user?.email}</p>
    <p><strong>ID Photos:</strong> {(page.data.session?.user as any)?.id_photos || "Non configuré"}</p>
    
    <div style="margin-top: 15px;">
      <label>
        Changer d'utilisateur (id_user):
        <input 
          type="text" 
          bind:value={currentUserId}
          placeholder="ex: jolan.boudin"
        />
      </label>
      <button onclick={changeCurrentUser}>
        ✓ Changer
      </button>
    </div>
  </div>

  <!-- Import photo de profil -->
  <div class="section">
    <h2>📸 Photo de profil</h2>
    <p>Importez une photo pour configurer votre reconnaissance faciale et accéder à "Mes photos".</p>
    
    <div style="margin: 20px 0;">
      <input 
        type="file" 
        accept="image/*"
        onchange={importPhoto}
        disabled={isProcessing}
      />
      {#if isProcessing}
        <span style="margin-left: 10px;">⏳ Traitement en cours...</span>
      {/if}
    </div>

    {#if uploadStatus}
      <div class="status-box">
        <strong>Statut :</strong> {uploadStatus}
      </div>
    {/if}

    {#if canRetry}
      <button onclick={retryRecognition} disabled={isProcessing}>
        🔄 Réessayer la reconnaissance
      </button>
      <p style="color: #666; font-size: 0.9em; margin-top: 10px;">
        La reconnaissance peut prendre du temps. Vous pouvez attendre un peu puis réessayer.
      </p>
    {/if}

    {#if needsNewPhoto}
      <p style="color: #e74c3c; font-weight: bold;">
        ⚠️ Veuillez choisir une photo avec une seule personne visible.
      </p>
    {/if}

    {#if assetId && !needsNewPhoto}
      <p><strong>ID de l'asset :</strong> <code>{assetId}</code></p>
    {/if}

    {#if personId}
      <p><strong>ID de la personne :</strong> <code>{personId}</code></p>
    {/if}
  </div>

  <!-- Gestionnaire de base de données -->
  <div class="section">
    <button 
      onclick={() => showDbManager = !showDbManager}
      style="width: 100%;"
    >
      {showDbManager ? '▼' : '▶'} Gestionnaire de base de données (Admin)
    </button>

    {#if showDbManager}
      <div style="margin-top: 20px;">
        
        <!-- Affichage des utilisateurs -->
        <h3>📋 Utilisateurs dans la base de données</h3>
        {#if allUsers.length > 0}
          <table>
            <thead>
              <tr>
                <th>ID User</th>
                <th>Email</th>
                <th>Prénom</th>
                <th>Nom</th>
                <th>ID Photos</th>
                <th>First Login</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {#each allUsers as user}
                <tr>
                    {#if editingUserId === user.id_user}
                      <td>{user.id_user}</td>
                      <td><input type="email" bind:value={editingUserData.email} /></td>
                      <td><input type="text" bind:value={editingUserData.prenom} /></td>
                      <td><input type="text" bind:value={editingUserData.nom} /></td>
                      <td><input type="text" bind:value={editingUserData.id_photos} /></td>
                      <td>{user.first_login ? 'Oui' : 'Non'}</td>
                      <td>
                        <select bind:value={editingUserData.role}>
                          <option value="user">user</option>
                          <option value="mitviste">mitviste</option>
                          <option value="admin">admin</option>
                        </select>
                      </td>
                      <td>
                        <input type="number" min="1900" max="2100" bind:value={editingUserData.promo_year} />
                      </td>
                      <td>
                        <button onclick={saveUserEdit} class="success-button">Save</button>
                        <button onclick={cancelEditUser} style="margin-left:8px;">Cancel</button>
                      </td>
                    {:else}
                      <td>{user.id_user}</td>
                      <td>{user.email}</td>
                      <td>{user.prenom}</td>
                      <td>{user.nom}</td>
                      <td><code>{user.id_photos || 'Non configuré'}</code></td>
                      <td>{user.first_login ? 'Oui' : 'Non'}</td>
                      <td>{user.role || 'user'}</td>
                      <td>{user.promo_year ?? '-'}</td>
                      <td>
                        <button onclick={() => startEditUser(user)}>Edit</button>
                        <button onclick={() => deleteUser(user.id_user)} style="margin-left:8px;">Delete</button>
                      </td>
                    {/if}
                  </tr>
              {/each}
            </tbody>
          </table>
        {:else}
          <p>Chargez les utilisateurs pour voir la liste.</p>
        {/if}

        <!-- Formulaire d'ajout -->
        <h3>➕ Ajouter un utilisateur</h3>
        <div class="form-grid">
          <div>
            <label for="newUser_id_user">ID User *</label>
            <input 
              id="newUser_id_user"
              type="text" 
              bind:value={newUserData.id_user}
              placeholder="ex: john.doe"
            />
          </div>
          <div>
            <label for="newUser_email">Email *</label>
            <input 
              id="newUser_email"
              type="email" 
              bind:value={newUserData.email}
              placeholder="john.doe@example.com"
            />
          </div>
          <div>
            <label for="newUser_prenom">Prénom *</label>
            <input 
              id="newUser_prenom"
              type="text" 
              bind:value={newUserData.prenom}
              placeholder="John"
            />
          </div>
          <div>
            <label for="newUser_nom">Nom *</label>
            <input 
              id="newUser_nom"
              type="text" 
              bind:value={newUserData.nom}
              placeholder="DOE"
            />
          </div>
          <div class="full-width">
            <label for="newUser_id_photos">ID Photos (optionnel)</label>
            <input 
              id="newUser_id_photos"
              type="text" 
              bind:value={newUserData.id_photos}
              placeholder="Laisser vide pour un nouvel utilisateur"
            />
          </div>
        </div>
        <button 
          onclick={addUser}
          class="success-button"
        >
          ➕ Ajouter l'utilisateur
        </button>
      </div>
    {/if}
  </div>
  <!-- Albums manager -->
  <div class="section">
    <button onclick={() => showAlbumManager = !showAlbumManager} style="width:100%">
      {showAlbumManager ? '▼' : '▶'} Gestion des albums
    </button>

    {#if showAlbumManager}
      <div style="margin-top: 20px;">
        <h3>Gestion des albums (via Immich)</h3>
        <p>Les albums proviennent d'Immich. Utilisez le bouton ci-dessous pour synchroniser la liste locale avec Immich. La création d'albums manuelle n'est pas nécessaire.</p>
        <button onclick={importAlbumsFromImmich} style="margin-top:12px; background:#6c757d;">Importer depuis Immich</button>

        <h3 style="margin-top:20px;">📚 Albums existants</h3>
        {#if albums.length > 0}
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Date</th>
                <th>Location</th>
                <th>Visibility</th>
                <th>Visible</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {#each albums as a}
                <tr>
                  {#if editingAlbumId === a.id}
                    <td>{a.id}</td>
                    <td><input type="text" bind:value={editingAlbumData.name} /></td>
                    <td><input type="date" bind:value={editingAlbumData.date} /></td>
                    <td><input type="text" bind:value={editingAlbumData.location} /></td>
                    <td>
                      <select bind:value={editingAlbumData.visibility}>
                        <option value="private">Privé</option>
                        <option value="authenticated">Public (auth)</option>
                        <option value="unlisted">Accès par lien</option>
                      </select>
                    </td>
                    <td>
                      <label style="display:flex;align-items:center;gap:8px;">
                        <input type="checkbox" bind:checked={editingAlbumData.visible} />
                      </label>
                    </td>
                    <td>
                      <button onclick={saveAlbumEdit} class="success-button">Save</button>
                      <button onclick={cancelEditAlbum} style="margin-left:8px;">Cancel</button>
                    </td>
                  {:else}
                    <td>{a.id}</td>
                    <td>{a.name}</td>
                    <td>{a.date ?? '-'}</td>
                    <td>{a.location ?? '-'}</td>
                    <td>{a.visibility}</td>
                    <td>{a.visible ? 'Oui' : 'Non'}</td>
                    <td>
                      <button onclick={() => window.open(`/albums/${a.id}`, '_blank')}>Open</button>
                      <button onclick={() => startEditAlbum(a)} style="margin-left:8px;">Edit</button>
                      <button onclick={() => deleteAlbum(a.id)} style="margin-left:8px;">Delete</button>
                    </td>
                  {/if}
                </tr>
                {#if editingAlbumId === a.id}
                  <tr>
                    <td colspan="7">
                      <div style="display:flex;gap:12px;align-items:center;">
                        <label for={"editingAlbum_tags_" + a.id} style="min-width:80px;">Tags:</label>
                        <input id={"editingAlbum_tags_" + a.id} type="text" style="flex:1;" bind:value={editingAlbumData.tags} placeholder="Ex: Promo 2024, VIP" />
                        <label for={"editingAlbum_allowed_" + a.id} style="min-width:120px;">Allowed users (comma):</label>
                        <input id={"editingAlbum_allowed_" + a.id} type="text" style="flex:1;" bind:value={editingAlbumData.allowed_users} placeholder="ex: alice.bob, john.doe" />
                      </div>
                      <p style="margin:8px 0 0 0;color:#666;font-size:0.9em;">Ajoutez des tags (séparés par des virgules) et des id_user autorisés. Cliquez sur Save pour appliquer.</p>
                    </td>
                  </tr>
                {/if}
              {/each}
            </tbody>
          </table>
        {:else}
          <p>Aucun album pour le moment.</p>
        {/if}
      </div>
    {/if}
  </div>
</main>
