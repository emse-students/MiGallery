<script lang="ts">
  import { page } from "$app/stores";
  import { goto } from "$app/navigation";
  import { onMount } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import LazyImage from '$lib/components/LazyImage.svelte';
  import type { User } from '$lib/types/api';
  import { showConfirm } from '$lib/confirm';
  import { toast } from '$lib/toast';

  let loading = $state(false);
  let error = $state<string | null>(null);
  let users = $state<User[]>([]);

  // Modal d'édition/ajout utilisateur
  let showEditUserModal = $state(false);
  let editMode = $state<'add' | 'edit'>('add');
  let editUserData = $state({
    id_user: '',
    email: '',
    prenom: '',
    nom: '',
    role: 'user',
    promo_year: null as number | null,
    id_photos: null as string | null
  });
  let selectedUser = $state<User | null>(null);

  // Upload photo pour liaison Immich
  let uploadingPhoto = $state(false);
  let uploadPhotoFile = $state<File | null>(null);

  // Vérifier le rôle de l'utilisateur
  let userRole = $derived((($page.data.session?.user as User)?.role) || 'user');
  let currentUserId = $derived(($page.data.session?.user as User)?.id_user);
  let canAccess = $derived(userRole === 'admin');

  async function fetchUsers() {
    loading = true;
    error = null;
    users = [];

    try {
      // Récupérer tous les utilisateurs via l'API dédiée
      const res = await fetch('/api/users');
      if (!res.ok) {
        const errText = await res.text().catch(() => res.statusText);
        throw new Error(errText || 'Erreur lors du chargement');
      }
      const data = (await res.json()) as { users: User[] };
      users = data.users || [];
    } catch (e: unknown) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  }

  function handleUserClick(userId: string) {
    goto(`/mes-photos?userId=${userId}`);
  }

  function getUserInitials(user: User): string {
    const prenom = user.prenom || '';
    const nom = user.nom || '';
    return `${prenom.charAt(0)}${nom.charAt(0)}`.toUpperCase();
  }

  function openAddUserModal() {
    editMode = 'add';
    editUserData = {
      id_user: '',
      email: '',
      prenom: '',
      nom: '',
      role: 'user',
      promo_year: null,
      id_photos: null
    };
    uploadPhotoFile = null;
    showEditUserModal = true;
  }

  function openEditUserModal(user: User, e: MouseEvent) {
    e.stopPropagation();
    editMode = 'edit';
    editUserData = {
      id_user: user.id_user,
      email: user.email || '',
      prenom: user.prenom || '',
      nom: user.nom || '',
      role: user.role || 'user',
      promo_year: user.promo_year || null,
      id_photos: user.id_photos || null
    };
    uploadPhotoFile = null;
    selectedUser = user;
    showEditUserModal = true;
  }

  async function saveUser() {
    // Validation
    if (!editUserData.id_user || !editUserData.email || !editUserData.prenom || !editUserData.nom) {
      toast.error('Les champs ID, email, prénom et nom sont requis.');
      return;
    }

    try {
      // Si on upload une photo, traiter la reconnaissance faciale d'abord
      let finalIdPhotos = editUserData.id_photos;

      if (uploadPhotoFile) {
        uploadingPhoto = true;

        // 1. Upload l'image vers Immich
        const formData = new FormData();
        formData.append('assetData', uploadPhotoFile);
        formData.append('deviceAssetId', `${uploadPhotoFile.name}-${Date.now()}`);
        formData.append('deviceId', 'MiGallery-Web');
        formData.append('fileCreatedAt', new Date().toISOString());
        formData.append('fileModifiedAt', new Date().toISOString());

        const uploadRes = await fetch('/api/immich/assets', {
          method: 'POST',
          body: formData
        });

        if (!uploadRes.ok) {
          throw new Error('Erreur lors de l\'upload de la photo');
        }

        const uploadData = (await uploadRes.json()) as { id: string };
        const assetId = uploadData.id;

        if (!assetId) {
          throw new Error('Asset ID non récupéré après upload');
        }

        // 2. Attendre que la reconnaissance faciale traite l'image (8 secondes)
        await new Promise(resolve => setTimeout(resolve, 8000));

        // 3. Récupérer les informations de l'asset pour voir les personnes détectées
        const assetInfoRes = await fetch(`/api/immich/assets/${assetId}`);

        if (!assetInfoRes.ok) {
          throw new Error('Erreur lors de la récupération des informations de l\'asset');
        }

        const assetInfo = (await assetInfoRes.json()) as { people: { id: string }[] };
        const people = assetInfo.people || [];

        if (people.length === 0) {
          uploadingPhoto = false;
          toast.error('Aucune personne détectée sur cette photo. Veuillez choisir une photo avec un visage visible.');
          return;
        }

        if (people.length > 1) {
          uploadingPhoto = false;
          toast.error(`Plusieurs personnes détectées (${people.length}). Veuillez choisir une photo avec une seule personne.`);
          return;
        }

        // Une seule personne détectée, parfait !
        finalIdPhotos = people[0].id;
        uploadingPhoto = false;
      }

      if (editMode === 'add') {
        // Ajouter l'utilisateur via API dédiée
        const res = await fetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id_user: editUserData.id_user,
            email: editUserData.email,
            prenom: editUserData.prenom,
            nom: editUserData.nom,
            role: editUserData.role,
            promo_year: editUserData.promo_year,
            id_photos: finalIdPhotos
          })
        });

        if (!res.ok) {
          const txt = await res.text().catch(() => res.statusText);
          throw new Error(txt || 'Erreur lors de l\'ajout de l\'utilisateur');
        }

        await fetchUsers();
      } else {
        // Modifier l'utilisateur via API dédiée
        const res = await fetch(`/api/users/${encodeURIComponent(editUserData.id_user)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: editUserData.email,
            prenom: editUserData.prenom,
            nom: editUserData.nom,
            role: editUserData.role,
            promo_year: editUserData.promo_year,
            id_photos: finalIdPhotos
          })
        });

        if (!res.ok) {
          const txt = await res.text().catch(() => res.statusText);
          throw new Error(txt || 'Erreur lors de la modification de l\'utilisateur');
        }

        await fetchUsers();
      }

      showEditUserModal = false;
      selectedUser = null;
      uploadPhotoFile = null;
    } catch (e: unknown) {
      uploadingPhoto = false;
      toast.error('Erreur: ' + (e as Error).message);
    }
  }

  async function deleteUserConfirm(user: User, event: MouseEvent) {
    event.stopPropagation();

    if (user.id_user === currentUserId) {
      toast.error('Vous ne pouvez pas supprimer votre propre compte.');
      return;
    }

    const ok = await showConfirm(`Supprimer l'utilisateur ${user.prenom} ${user.nom} ?\n\nCette action est irréversible.`, 'Supprimer l\'utilisateur');
    if (!ok) return;

    try {
      const res = await fetch(`/api/users/${encodeURIComponent(user.id_user)}`, { method: 'DELETE' });
      if (!res.ok) {
        const txt = await res.text().catch(() => res.statusText);
        throw new Error(txt || 'Erreur lors de la suppression');
      }
      await fetchUsers();
    } catch (e: unknown) {
      toast.error('Erreur: ' + (e as Error).message);
    }
  }

  onMount(() => {
    if (!canAccess) {
      goto('/');
      return;
    }
    fetchUsers();
  });
</script>

<svelte:head>
  <title>Trombinoscope - MiGallery</title>
</svelte:head>

<main class="trombinoscope-main">
  <div class="page-background"></div>

  <div class="header-with-actions">
    <h1 class="page-title">Trombinoscope</h1>

    <button class="btn-add-user" onclick={openAddUserModal}>
      <Icon name="plus" size={20} />
      <span>Ajouter un utilisateur</span>
    </button>
  </div>

  {#if error}
    <div class="error"><Icon name="x-circle" size={20} /> Erreur: {error}</div>
  {/if}

  {#if loading}
    <div class="loading"><Spinner size={20} /> Chargement des utilisateurs...</div>
  {/if}

  {#if !loading && !error && users.length === 0}
    <div class="empty-state">
      <Icon name="users" size={48} />
      <p>Aucun utilisateur trouvé</p>
    </div>
  {/if}

  {#if users.length > 0}
    <div class="users-count"><strong>{users.length}</strong> utilisateur{users.length > 1 ? 's' : ''}</div>

    {@const usersByPromo = users.reduce((acc, user) => {
      const promo = user.promo_year || 'Sans promo';
      if (!acc[promo]) acc[promo] = [];
      acc[promo].push(user);
      return acc;
    }, {} as Record<string, User[]>)}

    {#each Object.entries(usersByPromo).sort(([a], [b]) => {
      if (a === 'Sans promo') return 1;
      if (b === 'Sans promo') return -1;
      return Number(b) - Number(a);
    }) as [promo, promoUsers]}
      <h2 class="promo-label">{promo === 'Sans promo' ? 'Sans promo' : `Promo ${promo}`}</h2>
      <div class="users-grid">
        {#each promoUsers as user (user.id_user)}
          <div
            class="user-card"
            role="button"
            tabindex="0"
            onclick={() => handleUserClick(user.id_user)}
            onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleUserClick(user.id_user); } }}
          >
            <button
              class="edit-user-btn"
              onclick={(e) => openEditUserModal(user, e)}
              title="Modifier l'utilisateur"
            >
              <Icon name="edit" size={16} />
            </button>

            <button
              class="delete-user-btn"
              onclick={(e) => deleteUserConfirm(user, e)}
              title="Supprimer l'utilisateur"
            >
              <Icon name="trash" size={16} />
            </button>

            <div class="user-photo">
              {#if user.id_photos}
                <img
                  src={`/api/immich/people/${user.id_photos}/thumbnail`}
                  alt={`${user.prenom} ${user.nom}`}
                  onerror={(e) => {
                    const target = e.currentTarget as HTMLImageElement;
                    target.style.display = 'none';
                    const parent = target.parentElement;
                    if (parent) {
                      const initials = document.createElement('div');
                      initials.className = 'user-initials';
                      initials.textContent = getUserInitials(user);
                      parent.appendChild(initials);
                    }
                  }}
                />
              {:else}
                <div class="user-initials">
                  {getUserInitials(user)}
                </div>
              {/if}
            </div>
            <div class="user-info">
              <div class="user-name">{user.prenom} {user.nom}</div>
              {#if user.role && user.role !== 'user'}
                <div class="user-role {user.role}">{user.role}</div>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/each}
  {/if}

  {#if showEditUserModal}
    <div
      class="modal-overlay"
      onclick={() => showEditUserModal = false}
      role="button"
      tabindex="0"
      aria-label="Fermer la boîte de dialogue"
      onkeydown={(e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          showEditUserModal = false;
        }
      }}
    >
      <div
        class="modal-content modal-content-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        tabindex="-1"
        onclick={(e) => e.stopPropagation()}
        onkeydown={(e: KeyboardEvent) => {
          if (e.key === 'Escape') {
            showEditUserModal = false;
          }
        }}
      >
        <h2 id="dialog-title">
          <Icon name={editMode === 'add' ? 'plus' : 'edit'} size={24} />
          {editMode === 'add' ? 'Ajouter un utilisateur' : 'Modifier l\'utilisateur'}
        </h2>

        <div class="form-grid">
          <div class="form-group">
            <label for="id_user">ID utilisateur *</label>
            <input
              id="id_user"
              type="text"
              bind:value={editUserData.id_user}
              disabled={editMode === 'edit'}
              placeholder="ex: jean.dupont"
            />
          </div>

          <div class="form-group">
            <label for="email">Email *</label>
            <input
              id="email"
              type="email"
              bind:value={editUserData.email}
              placeholder="ex: jean.dupont@emse.fr"
            />
          </div>

          <div class="form-group">
            <label for="prenom">Prénom *</label>
            <input
              id="prenom"
              type="text"
              bind:value={editUserData.prenom}
              placeholder="Jean"
            />
          </div>

          <div class="form-group">
            <label for="nom">Nom *</label>
            <input
              id="nom"
              type="text"
              bind:value={editUserData.nom}
              placeholder="Dupont"
            />
          </div>

          <div class="form-group">
            <label for="promo_year">Promo</label>
            <input
              id="promo_year"
              type="number"
              bind:value={editUserData.promo_year}
              placeholder="2025"
            />
          </div>

          <div class="form-group">
            <label for="role">Rôle</label>
            <select id="role" bind:value={editUserData.role}>
              <option value="user">Utilisateur</option>
              <option value="mitviste">Mitviste</option>
              <option value="admin">Admin</option>
            </select>
          </div>
        </div>

        <div class="form-section">
          <h3>
            <Icon name="camera" size={20} />
            Liaison Immich (photo de profil)
          </h3>
          <p class="form-help">
            {#if editUserData.id_photos}
              ✓ Photo déjà configurée (ID: {editUserData.id_photos})
            {:else}
              Aucune photo configurée
            {/if}
          </p>
          <div class="upload-zone">
            <input
              type="file"
              accept="image/*"
              onchange={(e) => {
                const target = e.target as HTMLInputElement;
                uploadPhotoFile = target.files?.[0] || null;
              }}
            />
            {#if uploadPhotoFile}
              <p class="upload-status">
                <Icon name="image" size={16} />
                Photo sélectionnée: {uploadPhotoFile.name}
              </p>
            {:else}
              <p class="upload-help">Sélectionnez une photo pour créer/mettre à jour le profil Immich</p>
            {/if}
          </div>
        </div>

        <div class="modal-actions">
          <button class="btn-cancel" onclick={() => showEditUserModal = false} disabled={uploadingPhoto}>
            Annuler
          </button>
          <button class="btn-confirm" onclick={saveUser} disabled={uploadingPhoto}>
            {#if uploadingPhoto}
              <Spinner size={18} />
              Upload en cours...
            {:else}
              <Icon name="check" size={18} />
              {editMode === 'add' ? 'Créer' : 'Sauvegarder'}
            {/if}
          </button>
        </div>
      </div>
    </div>
  {/if}
</main>

<style>
  .trombinoscope-main {
    position: relative;
    min-height: 100vh;
  }

  .page-background {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: -1;
    background:
      radial-gradient(ellipse 80% 50% at 50% -20%, rgba(168, 85, 247, 0.15), transparent),
      radial-gradient(ellipse 60% 50% at 0% 100%, rgba(236, 72, 153, 0.1), transparent),
      radial-gradient(ellipse 60% 50% at 100% 100%, rgba(59, 130, 246, 0.1), transparent);
    pointer-events: none;
    overflow: hidden;
  }

  .page-title {
    text-align: center;
    font-size: 3rem;
    font-weight: 700;
    margin: 0;
    color: var(--text-primary);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 1rem;
  }

  .header-with-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: 2rem 0 3rem;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .header-with-actions .page-title {
    margin: 0;
    flex: 1;
  }

  .btn-add-user {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1.5rem;
    background: linear-gradient(90deg, rgba(34, 197, 94, 0.9), rgba(16, 185, 129, 0.9));
    color: white;
    border: none;
    border-radius: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
    box-shadow: 0 4px 12px rgba(34, 197, 94, 0.3);
  }

  .btn-add-user:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(34, 197, 94, 0.4);
  }

  .promo-label {
    margin-top: 3rem;
    margin-bottom: 1.5rem;
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--text-primary);
    text-align: left;
    opacity: 0.9;
  }

  .promo-label:first-of-type {
    margin-top: 2rem;
  }

  .users-count {
    margin-bottom: 1rem;
    font-size: 0.9375rem;
    color: var(--text-secondary);
    text-align: center;
  }

  .users-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 1.25rem;
    padding: 0 0 2rem 0;
  }

  .user-card {
    background: var(--bg-elevated);
    border-radius: 16px;
    padding: 1.5rem;
    cursor: pointer;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    border: 1px solid var(--border-color);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    min-height: 220px;
    justify-content: center;
    position: relative;
  }

  .edit-user-btn {
    position: absolute;
    top: 0.75rem;
    right: 0.75rem;
    background: rgba(168, 85, 247, 0.2);
    border: 1px solid rgba(168, 85, 247, 0.3);
    color: rgba(168, 85, 247, 1);
    border-radius: 8px;
    padding: 0.5rem;
    cursor: pointer;
    transition: all 0.2s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    z-index: 10;
  }

  .user-card:hover .edit-user-btn {
    opacity: 1;
  }

  .edit-user-btn:hover {
    background: rgba(168, 85, 247, 0.3);
    transform: scale(1.1);
  }

  .delete-user-btn {
    position: absolute;
    bottom: 0.75rem;
    right: 0.75rem;
    background: rgba(220, 38, 38, 0.2);
    border: 1px solid rgba(220, 38, 38, 0.3);
    color: rgba(220, 38, 38, 1);
    border-radius: 8px;
    padding: 0.5rem;
    cursor: pointer;
    transition: all 0.2s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    z-index: 10;
  }

  .user-card:hover .delete-user-btn {
    opacity: 1;
  }

  .delete-user-btn:hover {
    background: rgba(220, 38, 38, 0.4);
    transform: scale(1.1);
  }

  .user-card:hover {
    transform: translateY(-4px) scale(1.02);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.3);
    background: var(--bg-tertiary);
    border-color: var(--accent);
  }

  .user-photo {
    width: 100px;
    height: 100px;
    border-radius: 50%;
    overflow: hidden;
    background: var(--bg-secondary);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    border: 3px solid rgba(255, 255, 255, 0.1);
    transition: border-color 0.3s ease;
  }

  .user-card:hover .user-photo {
    border-color: var(--accent);
  }

  .user-photo img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .user-initials {
    font-size: 2rem;
    font-weight: 700;
    color: var(--text-primary);
  }

  .user-info {
    text-align: center;
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.375rem;
    flex: 1;
    justify-content: center;
  }

  .user-name {
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-primary);
    line-height: 1.3;
  }

  .user-promo {
    font-size: 0.8125rem;
    color: var(--text-secondary);
  }

  .user-role {
    font-size: 0.6875rem;
    text-transform: uppercase;
    font-weight: 600;
    padding: 0.25rem 0.625rem;
    border-radius: 8px;
    display: inline-block;
    letter-spacing: 0.03em;
  }

  .user-role.admin {
    color: rgba(59, 130, 246, 1);
    background: rgba(59, 130, 246, 0.15);
    border: 1px solid rgba(59, 130, 246, 0.3);
  }

  .user-role.mitviste {
    color: rgba(236, 72, 153, 1);
    background: rgba(236, 72, 153, 0.15);
    border: 1px solid rgba(236, 72, 153, 0.3);
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    padding: 4rem 1rem;
    color: var(--text-secondary);
  }

  .empty-state p {
    font-size: 1.125rem;
    margin: 0;
  }

  /* Modal styles */
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    backdrop-filter: blur(4px);
  }

  .modal-content {
    background: var(--bg-elevated);
    border-radius: 16px;
    padding: 2rem;
    max-width: 500px;
    width: 90%;
    box-shadow: 0 24px 48px rgba(0, 0, 0, 0.5);
    border: 1px solid var(--border);
  }

  .modal-content h2 {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin: 0 0 1.5rem 0;
    font-size: 1.5rem;
    color: var(--text-primary);
  }

  .modal-user-info {
    text-align: center;
    margin-bottom: 1.5rem;
    font-size: 1.125rem;
    color: var(--text-secondary);
  }

  .modal-actions {
    display: flex;
    gap: 1rem;
    justify-content: flex-end;
  }

  .btn-cancel,
  .btn-confirm {
    padding: 0.75rem 1.5rem;
    border-radius: 8px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
    border: none;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .btn-cancel {
    background: var(--bg-secondary);
    color: var(--text-primary);
    border: 1px solid var(--border);
  }

  .btn-cancel:hover {
    background: var(--bg-tertiary);
  }

  .btn-confirm {
    background: linear-gradient(90deg, var(--accent), #8b5cf6);
    color: white;
  }

  .btn-confirm:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 16px rgba(59, 130, 246, 0.3);
  }

  .btn-confirm:disabled,
  .btn-cancel:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-confirm:disabled:hover,
  .btn-cancel:disabled:hover {
    transform: none;
    box-shadow: none;
  }

  /* Modal d'édition utilisateur */
  .modal-content-wide {
    max-width: 700px;
  }

  .form-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 1.25rem;
    margin-bottom: 1.5rem;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .form-group label {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .form-group input,
  .form-group select {
    padding: 0.75rem;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text-primary);
    font-size: 1rem;
    transition: border-color 0.2s ease;
  }

  .form-group input:focus,
  .form-group select:focus {
    outline: none;
    border-color: var(--accent);
  }

  .form-group input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .form-section {
    margin-bottom: 1.5rem;
    padding: 1.25rem;
    background: var(--bg-secondary);
    border-radius: 12px;
    border: 1px solid var(--border);
  }

  .form-section h3 {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 1.125rem;
    margin: 0 0 0.75rem 0;
    color: var(--text-primary);
  }

  .form-help {
    font-size: 0.875rem;
    color: var(--text-secondary);
    margin-bottom: 1rem;
  }

  .upload-zone {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .upload-zone input[type="file"] {
    padding: 0.75rem;
    background: var(--bg-elevated);
    border: 2px dashed var(--border);
    border-radius: 8px;
    cursor: pointer;
    color: var(--text-primary);
  }

  .upload-zone input[type="file"]:hover {
    border-color: var(--accent);
  }

  .upload-status {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem;
    background: rgba(34, 197, 94, 0.15);
    border: 1px solid rgba(34, 197, 94, 0.3);
    color: rgba(34, 197, 94, 1);
    border-radius: 8px;
    font-size: 0.875rem;
    margin: 0;
  }

  .upload-help {
    font-size: 0.875rem;
    color: var(--text-secondary);
    font-style: italic;
    margin: 0;
  }

  @media (max-width: 768px) {
    .users-grid {
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
      gap: 1rem;
    }

    .user-card {
      padding: 1rem;
    }

    .user-photo {
      width: 80px;
      height: 80px;
    }

    .user-initials {
      font-size: 1.5rem;
    }

    .edit-user-btn,
    .delete-user-btn {
      opacity: 1;
    }

    .header-with-actions {
      flex-direction: column;
      align-items: stretch;
    }

    .btn-add-user {
      justify-content: center;
    }

    .form-grid {
      grid-template-columns: 1fr;
    }

    .modal-content {
      padding: 1.5rem;
    }

    .modal-actions {
      flex-direction: column;
    }

    .btn-cancel,
    .btn-confirm {
      width: 100%;
      justify-content: center;
    }

    .page-title {
      font-size: 2rem;
    }

    .promo-label {
      font-size: 1.25rem;
    }
  }
</style>
