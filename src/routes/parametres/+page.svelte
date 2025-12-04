<script lang="ts">
  import { page } from "$app/state";
  import Icon from "$lib/components/Icon.svelte";
  import Spinner from '$lib/components/Spinner.svelte';
  import CameraInput from '$lib/components/CameraInput.svelte';
  import { theme } from '$lib/theme';
  import { asApiResponse } from '$lib/ts-utils';
  import type { UserRow, Album, User } from '$lib/types/api';
  import { showConfirm } from '$lib/confirm';
  import { toast } from '$lib/toast';

  let isAdmin = $derived((page.data.session?.user as User)?.role === 'admin');

  let uploadStatus = $state<string>("");
  let assetId = $state<string | null>(null);
  let tagAssetId = $state<string>("");
  let tagOpStatus = $state<string>("");
  let assetDescription = $state<string>('');
  let personId = $state<string | null>(null);

  let isProcessing = $state<boolean>(false);
  let canRetry = $state<boolean>(false);
  let needsNewPhoto = $state<boolean>(false);

  // État pour la gestion de la BDD et de l'utilisateur
  let allUsers = $state<UserRow[]>([]);
  let editingUserId = $state<string | null>(null);
  let editingUserData = $state({ id_user: '', email: '', prenom: '', nom: '', id_photos: '', role: 'user' as 'admin' | 'mitviste' | 'user', promo_year: null as number | null });

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

    const jsonData = await response.json();
    const result = asApiResponse<UserRow[]>(jsonData);
    if (result.success && result.data) {
      allUsers = result.data;
    }
  }

  async function addUser() {
      if (!newUserData.id_user || !newUserData.email || !newUserData.prenom || !newUserData.nom) {
        toast.error("Les champs id_user, email, prenom et nom sont requis !");
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

    const jsonData = await response.json();
    const result = asApiResponse(jsonData);
    if (result.success) {
      toast.success("Utilisateur ajouté avec succès !");
      newUserData = { id_user: "", email: "", prenom: "", nom: "", id_photos: "" };
      await loadAllUsers();
    } else {
      toast.error(`Erreur: ${result.error || 'Unknown error'}`);
    }
  }

  async function startEditUser(user: UserRow) {
    editingUserId = user.id_user;
    editingUserData = { id_user: user.id_user, email: user.email, prenom: user.prenom, nom: user.nom, id_photos: user.id_photos || '', role: (user.role as 'admin' | 'mitviste' | 'user') || 'user', promo_year: user.promo_year };
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
    const jsonData = await res.json();
    const result = asApiResponse(jsonData);
    if (result.success) {
      editingUserId = null;
      await loadAllUsers();
    } else {
      toast.error('Erreur mise à jour utilisateur: ' + (result.error || 'unknown'));
    }
  }

  async function deleteUser(id_user: string) {
    const ok = await showConfirm('Supprimer cet utilisateur ? Cette action est irréversible.', 'Supprimer l\'utilisateur');
    if (!ok) return;
    await fetch('/api/db', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sql: 'DELETE FROM users WHERE id_user = ?', params: [id_user] }) });
    await loadAllUsers();
  }



  // ===== Albums management state & helpers =====
  let albums = $state<Album[]>([]);
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
    const jsonData = await res.json();
    const result = asApiResponse<Album[]>(jsonData);
    if (result.success && result.data) { albums = result.data; }
  }

  // No manual album creation: albums are sourced from Immich. Use import button to sync.

  async function startEditAlbum(a: Album) {
    editingAlbumId = a.id;
    // load tags and allowed users
    const tagsRes = await fetch('/api/db', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sql: 'SELECT tag FROM album_tag_permissions WHERE album_id = ?', params: [a.id] }) });
    const tagsJsonData = await tagsRes.json();
    const tagsResult = asApiResponse<Array<{ tag: string }>>(tagsJsonData);
    const tagsArr = tagsResult.success && tagsResult.data ? tagsResult.data.map((r) => r.tag) : [];
    const tags = tagsArr.join(', ');

    const usersRes = await fetch('/api/db', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sql: 'SELECT id_user FROM album_user_permissions WHERE album_id = ?', params: [a.id] }) });
    const usersJsonData = await usersRes.json();
    const usersResult = asApiResponse<Array<{ id_user: string }>>(usersJsonData);
    const usersArr = usersResult.success && usersResult.data ? usersResult.data.map((r) => r.id_user) : [];
    const users = usersArr.join(', ');

    editingAlbumExistingTags = tagsArr;
    editingAlbumExistingUsers = usersArr;

  editingAlbumData = { id: a.id, name: a.name, date: a.date || '', location: a.location || '', visibility: a.visibility || 'private', visible: Boolean(a.visible), tags, allowed_users: users };
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
    const ok = await showConfirm('Supprimer cet album ? Cette action est irréversible.', 'Supprimer l\'album');
    if (!ok) return;
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
        toast.error(`Erreur récupération albums Immich: ${res.status} ${res.statusText}`);
        return;
      }
      const list = (await res.json()) as unknown;
      if (!Array.isArray(list)) {
        toast.error('Réponse Immich inattendue');
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

      toast.success(`Import terminé : ${added} albums importés (visibilité=private)`);
      await loadAlbums();
    } catch (err: unknown) {
      console.error('Import albums error', err);
      toast.error('Erreur lors de l\'import des albums. Voir la console.');
    }
  }

  async function retryRecognition() {
    if (!assetId) return;

    canRetry = false;
    isProcessing = true;
    uploadStatus = "Nouvelle tentative de reconnaissance...";

    await checkForPeople(false, null);

    isProcessing = false;
  }

  /**
   * Vérifie si des personnes ont été détectées sur l'asset uploadé.
   * @param shouldDeleteAfter - Si true, supprime l'asset après reconnaissance réussie
   * @param assetIdToDelete - L'ID de l'asset à supprimer (peut être différent si c'était un duplicata)
   */
  async function checkForPeople(shouldDeleteAfter: boolean = false, assetIdToDelete: string | null = null) {
    const userId = (page.data.session?.user as User)?.id_user;

    if (!userId || !assetId) return;

    try {
      uploadStatus = "Récupération des personnes détectées...";
      const assetInfoResponse = await fetch(`/api/immich/assets/${assetId}`);

      if (!assetInfoResponse.ok) {
        throw new Error(`Erreur récupération asset: ${assetInfoResponse.statusText}`);
      }

      const assetInfoData = await assetInfoResponse.json();
      const assetInfo = assetInfoData as { people?: Array<{ id: string }> };
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

        const updateData = await updateResponse.json();
        const updateResult = asApiResponse(updateData);

        if (updateResult.success) {
          uploadStatus = `Terminé ! id_photos = ${personId}`;

          // Supprimer la photo temporaire AVANT le reload si nécessaire
          if (shouldDeleteAfter && assetIdToDelete) {
            uploadStatus = "Nettoyage : suppression de la photo temporaire...";
            try {
              await fetch(`/api/immich/assets`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: [assetIdToDelete] })
              });
            } catch (deleteErr) {
              console.warn("Impossible de supprimer la photo temporaire:", deleteErr);
            }
          }

          // Reload silently after successful profile photo setup
          window.location.reload();
        } else {
          uploadStatus = `Personne détectée mais erreur mise à jour BDD: ${updateResult.error}`;
        }
      } else if (people.length === 0) {
        uploadStatus = "Aucune personne détectée sur cette photo.";
        canRetry = true;
      } else {
        uploadStatus = `Plusieurs personnes détectées (${people.length}). Veuillez choisir une photo avec une seule personne.`;
        needsNewPhoto = true;
      }
    } catch (error: unknown) {
      uploadStatus = `Erreur: ${error instanceof Error ? error.message : 'Erreur inconnue'}`;
      console.error("Erreur lors de la vérification des personnes:", error);
    }
  }

  // ===== Photo CV description management =====
  async function loadAssetDescription(id: string) {
    tagOpStatus = '';
    assetDescription = '';
    if (!id) return;
    try {
      const res = await fetch(`/api/immich/assets/${id}`);
      if (!res.ok) throw new Error('Érreur récupération asset');
      const infoData = await res.json();
      const info = infoData as {
        description?: string | { value?: string };
        metadata?: { description?: string };
      };
      // Try several shapes where description might be stored
      if (typeof info.description === 'string' && info.description.trim()) {
        assetDescription = info.description;
      } else if (info.metadata && typeof info.metadata.description === 'string' && info.metadata.description.trim()) {
        assetDescription = info.metadata.description;
      } else if (info.description && typeof info.description === 'object' && 'value' in info.description && typeof info.description.value === 'string') {
        assetDescription = info.description.value;
      } else {
        assetDescription = '';
      }
    } catch (e: unknown) {
      tagOpStatus = (e as Error).message;
    }
  }

  async function importPhoto(file: File) {
    if (!file) return;

    const userId = (page.data.session?.user as User)?.id_user;

    if (!userId) {
      toast.error("Pas d'utilisateur connecté");
      return;
    }

    isProcessing = true;
    uploadStatus = "Upload en cours...";
    assetId = null;
    personId = null;
    canRetry = false;
    needsNewPhoto = false;

    let isDuplicate = false;
    let uploadedAssetId: string | null = null;

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

      const uploadData = await uploadResponse.json() as Record<string, unknown>;

      // Détecter si c'est un duplicata (Immich peut retourner { status: 'duplicate', id: '...' })
      if (uploadData.status === 'duplicate' && uploadData.id) {
        isDuplicate = true;
        uploadedAssetId = String(uploadData.id);
        assetId = uploadedAssetId;
        uploadStatus = "Photo déjà présente dans la base de données. Utilisation de l'existante.";
      } else if (uploadData.duplicateId) {
        isDuplicate = true;
        uploadedAssetId = String(uploadData.duplicateId);
        assetId = uploadedAssetId;
        uploadStatus = "Photo déjà présente dans la base de données. Utilisation de l'existante.";
      } else if (uploadData.id) {
        uploadedAssetId = String(uploadData.id);
        assetId = uploadedAssetId;
        uploadStatus = `Photo uploadée ! ID: ${assetId}`;
      } else {
        throw new Error('Upload réussi mais pas d\'ID retourné');
      }

      uploadStatus = "Analyse en cours (attente 8 secondes)...";
      await new Promise(resolve => setTimeout(resolve, 8000));

      // Passer les infos de suppression à checkForPeople pour qu'elle gère la suppression AVANT le reload
      const shouldDeleteAfter = !isDuplicate && !!uploadedAssetId;
      await checkForPeople(shouldDeleteAfter, uploadedAssetId);

    } catch (error: unknown) {
      uploadStatus = `Erreur: ${error instanceof Error ? error.message : 'Erreur inconnue'}`;
      console.error("Erreur import photo:", error);
    } finally {
      isProcessing = false;
    }
  }
</script>

<svelte:head>
  <title>Paramètres - MiGallery</title>
</svelte:head>

<main class="settings-main">
  <div class="page-background">
    <div class="gradient-blob blob-1"></div>
    <div class="gradient-blob blob-2"></div>
    <div class="gradient-blob blob-3"></div>
  </div>

  <h1><Icon name="settings" size={32} /> Paramètres</h1>

  <div class="section">
    <h3><Icon name="palette" size={24} /> Thème</h3>
    <p>Choisissez entre le thème clair et sombre selon vos préférences.</p>
    <button
      onclick={() => theme.toggle()}
      class="theme-toggle px-4 py-2 rounded flex items-center gap-2 bg-accent-primary text-white hover:bg-accent-secondary transition-colors"
      aria-label="Basculer le thème"
    >
      {#if $theme === 'dark'}
        <Icon name="sun" size={20} /> Passer au mode clair
      {:else}
        <Icon name="moon" size={20} /> Passer au mode sombre
      {/if}
    </button>
  </div>

  <!-- Section 'Utilisateur actuel' supprimée : utilisation réservée à /dev/login-as pour le développement -->

  <div class="section">
    <h2><Icon name="image" size={28} /> Photo de profil</h2>
    <p>Importez une photo pour configurer votre reconnaissance faciale et accéder à "Mes photos".</p>

    <div class="my-5">
      <CameraInput onPhoto={importPhoto} disabled={isProcessing} />
      {#if isProcessing}
        <span class="ml-2"><Spinner size={20} /> Traitement en cours...</span>
      {/if}
    </div>

    {#if uploadStatus}
      <div class="status-box">
        <strong>Statut :</strong> {uploadStatus}
      </div>
    {/if}

    {#if canRetry}
      <button onclick={retryRecognition} disabled={isProcessing}>
        <Icon name="refresh" size={20} /> Réessayer la reconnaissance
      </button>
      <p class="text-slate-600 text-sm mt-2.5">
        La reconnaissance peut prendre du temps. Vous pouvez attendre un peu puis réessayer.
      </p>
    {/if}

    {#if needsNewPhoto}
      <p class="text-red-600 font-bold">
        <Icon name="alert-circle" size={20} /> Veuillez choisir une photo avec une seule personne visible.
      </p>
    {/if}

    {#if assetId && !needsNewPhoto}
      <p><strong>ID de l'asset :</strong> <code>{assetId}</code></p>
    {/if}

    {#if personId}
      <p><strong>ID de la personne :</strong> <code>{personId}</code></p>
    {/if}
  </div>
</main>

<style>
</style>
