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
  let needsNewPhoto = $state<boolean>(false);
  let abortController: AbortController | null = null;

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
    const response = await fetch('/api/users');
    const jsonData = await response.json();
    const result = asApiResponse<{users: UserRow[]}>(jsonData);
    if (result.success && result.data?.users) {
      allUsers = result.data.users;
    }
  }

  async function addUser() {
      if (!newUserData.id_user || !newUserData.email || !newUserData.prenom || !newUserData.nom) {
        toast.error("Les champs id_user, email, prenom et nom sont requis !");
        return;
      }

    const response = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id_user: newUserData.id_user,
        email: newUserData.email,
        prenom: newUserData.prenom,
        nom: newUserData.nom,
        id_photos: newUserData.id_photos || null
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
    const res = await fetch(`/api/users/${editingUserId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: editingUserData.email,
        prenom: editingUserData.prenom,
        nom: editingUserData.nom,
        id_photos: editingUserData.id_photos || null,
        role: editingUserData.role || 'user',
        promo_year: editingUserData.promo_year || null
      })
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
    await fetch(`/api/users/${id_user}`, { method: 'DELETE' });
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
    const res = await fetch('/api/albums');
    const jsonData = await res.json() as Album[];
    albums = jsonData;
  }

  // No manual album creation: albums are sourced from Immich. Use import button to sync.

  async function startEditAlbum(a: Album) {
    editingAlbumId = a.id;
    // load tags and allowed users
    const res = await fetch(`/api/albums/${a.id}`);
    const jsonData = await res.json();
    const result = asApiResponse<{album: Album & {tags: string[], allowed_users: string[]}}>(jsonData);

    const tagsArr = result.success && result.data?.album?.tags ? result.data.album.tags : [];
    const usersArr = result.success && result.data?.album?.allowed_users ? result.data.album.allowed_users : [];
    const tags = tagsArr.join(', ');
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
    await fetch(`/api/albums/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: editingAlbumData.name,
        date: editingAlbumData.date || null,
        location: editingAlbumData.location || null,
        visibility: editingAlbumData.visibility || 'private',
        visible: editingAlbumData.visible
      })
    });

    // compute diffs for tags
    const desiredTags = editingAlbumData.tags ? editingAlbumData.tags.split(',').map((t: string) => t.trim()).filter(Boolean) : [];
    const toAddTags = desiredTags.filter(t => !editingAlbumExistingTags.includes(t));
    const toRemoveTags = editingAlbumExistingTags.filter(t => !desiredTags.includes(t));

    if (toAddTags.length > 0 || toRemoveTags.length > 0) {
      await fetch(`/api/albums/${id}/permissions/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ add: toAddTags, remove: toRemoveTags })
      });
    }

    // compute diffs for allowed users
    const desiredUsers = editingAlbumData.allowed_users ? editingAlbumData.allowed_users.split(',').map((u: string) => u.trim()).filter(Boolean) : [];
    const toAddUsers = desiredUsers.filter(u => !editingAlbumExistingUsers.includes(u));
    const toRemoveUsers = editingAlbumExistingUsers.filter(u => !desiredUsers.includes(u));

    if (toAddUsers.length > 0 || toRemoveUsers.length > 0) {
      await fetch(`/api/albums/${id}/permissions/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ add: toAddUsers, remove: toRemoveUsers })
      });
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
    await fetch(`/api/albums/${albumId}`, { method: 'DELETE' });
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

  // Import depuis Immich supprimé - les albums sont maintenant gérés manuellement



  /**
   * Vérifie si des personnes ont été détectées sur l'asset uploadé.
   * @param shouldDeleteAfter - Si true, nettoie l'asset temporaire après reconnaissance
   * @param assetIdToDelete - L'ID de l'asset à nettoyer (peut être différent si c'était un duplicata)
   */
  async function checkForPeople(shouldDeleteAfter: boolean = false, assetIdToDelete: string | null = null) {
    const userId = (page.data.session?.user as User)?.id_user;

    if (!userId || !assetId) return;

    let shouldCleanup = shouldDeleteAfter && assetIdToDelete;

    try {
      uploadStatus = "Récupération des personnes détectées...";
      const assetInfoResponse = await fetch(`/api/immich/assets/${assetId}`);

      if (!assetInfoResponse.ok) {
        throw new Error(`Erreur récupération asset: ${assetInfoResponse.statusText}`);
      }

      const assetInfoData = await assetInfoResponse.json();
      const assetInfo = assetInfoData as { people?: Array<{ id: string }> };
      const people = assetInfo.people || [];

      console.log('checkForPeople - Asset info:', assetInfo);
      console.log('checkForPeople - People array:', people);
      uploadStatus = `${people.length} personne(s) détectée(s)`;

      if (people.length === 1) {
        personId = people[0].id;
        uploadStatus = `Visage détecté avec succès !`;

        const updateResponse = await fetch('/api/users/me/face', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            person_id: personId
          })
        });

        const updateData = await updateResponse.json();
        const updateResult = asApiResponse(updateData);

        console.log('Update result:', updateResult);

        if (updateResult.success) {
          uploadStatus = `Configuration terminée !`;

          // Nettoyer la photo temporaire AVANT le reload si nécessaire
          if (shouldCleanup) {
            console.log('Nettoyage de la photo temporaire...');
            try {
              await fetch(`/api/immich/assets`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: [assetIdToDelete] })
              });
            } catch (deleteErr) {
              console.warn("Impossible de nettoyer la photo temporaire:", deleteErr);
            }
          }

          // Désactiver isProcessing pour éviter le message beforeunload
          isProcessing = false;

          console.log('Rechargement de la page...');
          // Reload après configuration réussie
          setTimeout(() => {
            window.location.href = window.location.href;
          }, 100);
        } else {
          uploadStatus = `Personne détectée mais erreur mise à jour BDD: ${updateResult.error || 'Erreur inconnue'}`;
        }
      } else if (people.length === 0) {
        uploadStatus = "Aucun visage détecté. Veuillez utiliser une photo de visage claire.";

        // Nettoyer la photo si nécessaire
        if (shouldCleanup) {
          try {
            await fetch(`/api/immich/assets`, {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ids: [assetIdToDelete] })
            });
          } catch (deleteErr) {
            console.warn("Impossible de nettoyer la photo:", deleteErr);
          }
        }
      } else {
        uploadStatus = `${people.length} visages détectés. Veuillez utiliser une photo avec un seul visage.`;
        needsNewPhoto = true;

        // Nettoyer la photo si nécessaire
        if (shouldCleanup) {
          try {
            await fetch(`/api/immich/assets`, {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ids: [assetIdToDelete] })
            });
            uploadStatus += " Photo supprimée.";
          } catch (deleteErr) {
            console.warn("Impossible de supprimer la photo:", deleteErr);
          }
        }
      }
    } catch (error: unknown) {
      uploadStatus = `Erreur: ${error instanceof Error ? error.message : 'Erreur inconnue'}`;
      console.error("Erreur lors de la vérification des personnes:", error);

      // Supprimer la photo en cas d'erreur aussi
      if (shouldCleanup) {
        try {
          await fetch(`/api/immich/assets`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: [assetIdToDelete] })
          });
        } catch (deleteErr) {
          console.warn("Impossible de supprimer la photo après erreur:", deleteErr);
        }
      }
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
    needsNewPhoto = false;

    // Créer un AbortController pour gérer l'annulation si la page est fermée
    abortController = new AbortController();
    const signal = abortController.signal;

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
        body: formData,
        signal
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

      uploadStatus = "Analyse de l'image en cours...";

      // Polling: vérifier toutes les secondes si un visage a été détecté (max 15 tentatives = 15s)
      const maxAttempts = 15;
      let attempt = 0;
      let faceDetected = false;

      while (attempt < maxAttempts && !faceDetected) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        attempt++;
        uploadStatus = `Analyse de l'image... (${attempt}s)`;

        try {
          // Ajouter un timestamp pour bypasser le cache du proxy
          const checkResponse = await fetch(`/api/immich/assets/${assetId}?nocache=${Date.now()}`, { signal });
          if (checkResponse.ok) {
            const checkData = await checkResponse.json();
            const checkInfo = checkData as { people?: Array<{ id: string }> };
            console.log(`Polling tentative ${attempt}:`, checkInfo.people?.length || 0, 'visage(s) détecté(s)');
            if (checkInfo.people && checkInfo.people.length > 0) {
              faceDetected = true;
              uploadStatus = "Visage détecté ! Finalisation...";
              break;
            }
          }
        } catch (pollError) {
          // Ignorer les erreurs de polling, continuer
          if (pollError instanceof Error && pollError.name === 'AbortError') {
            throw pollError; // Propager l'annulation
          }
          console.warn('Erreur polling:', pollError);
        }
      }

      if (!faceDetected) {
        uploadStatus = "Analyse terminée (délai d'attente atteint)";
      }

      // Passer les infos de nettoyage à checkForPeople
      const shouldDeleteAfter = !isDuplicate && !!uploadedAssetId;
      await checkForPeople(shouldDeleteAfter, uploadedAssetId);

    } catch (error: unknown) {
      // Si l'opération a été annulée (page fermée), ne rien faire
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('Upload annulé (page fermée)');
        return;
      }

      // En cas d'erreur, nettoyer la photo uploadée si ce n'était pas un duplicata
      if (!isDuplicate && uploadedAssetId) {
        try {
          await fetch(`/api/immich/assets`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: [uploadedAssetId] })
          });
        } catch (deleteErr) {
          console.warn("Impossible de supprimer la photo après erreur:", deleteErr);
        }
      }

      uploadStatus = `Erreur: ${error instanceof Error ? error.message : 'Erreur inconnue'}`;
      console.error("Erreur import photo:", error);
    } finally {
      isProcessing = false;
      abortController = null;
    }
  }

  // Gérer la fermeture de la page pendant un traitement en cours
  $effect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      // Ne bloquer que si un traitement est en cours ET qu'on n'est pas en train de recharger après succès
      if (isProcessing && abortController) {
        // Annuler l'opération en cours
        abortController.abort();

        // Avertir l'utilisateur
        e.preventDefault();
        e.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  });
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
    <p>Importez une photo de votre visage pour configurer votre reconnaissance faciale et accéder à "Mes photos".</p>

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
