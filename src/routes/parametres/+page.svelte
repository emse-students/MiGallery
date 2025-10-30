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

  // Charger les données au montage
  $effect(() => {
    if (showDbManager) {
      loadAllUsers();
    }
  });

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

  nav {
    margin-bottom: 30px;
  }

  nav a {
    text-decoration: none;
    color: #3498db;
    font-size: 1.1em;
  }

  nav a:hover {
    text-decoration: underline;
  }

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
  <nav><a href="/">← Accueil</a></nav>
  
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
              </tr>
            </thead>
            <tbody>
              {#each allUsers as user}
                <tr>
                  <td>{user.id_user}</td>
                  <td>{user.email}</td>
                  <td>{user.prenom}</td>
                  <td>{user.nom}</td>
                  <td><code>{user.id_photos || 'Non configuré'}</code></td>
                  <td>{user.first_login ? 'Oui' : 'Non'}</td>
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
</main>
