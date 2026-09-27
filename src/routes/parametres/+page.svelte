<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { onMount, onDestroy } from 'svelte';
  import {
    Camera,
    Palette,
    ScanEye,
    Info,
    CircleCheckBig,
    CircleAlert,
    X,
    ChevronRight,
    Trash2,
    TriangleAlert,
    Languages,
    Shield,
  } from '@lucide/svelte';
  import Modal from '$lib/components/Modal.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import CameraInput from '$lib/components/CameraInput.svelte';
  import BackgroundBlobs from '$lib/components/BackgroundBlobs.svelte';
  import ChangePhotoModal from '$lib/components/ChangePhotoModal.svelte';
  import Avatar from '$lib/components/Avatar.svelte';
  import { fuzzySearch } from '$lib/fuzzy';
  import { PhotosState } from '$lib/photos.svelte';
  import { theme, type ThemePreference } from '$lib/theme';
  import SettingsRow from '$lib/components/SettingsRow.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import { asApiResponse } from '$lib/ts-utils';
  import type { UserRow, Album, User } from '$lib/types/api';
  import { showConfirm } from '$lib/confirm';
  import { toast } from '$lib/toast';
  import { uploadFileChunked } from '$lib/album-operations';
  import { m } from '$lib/paraglide/messages';
  import { getLocale, type Locale } from '$lib/paraglide/runtime';
  import { switchLocale } from '$lib/locale';

  const photosState = new PhotosState();
  /** The theme choices, in Google Photos' order: the device's own first. */
  const THEME_CHOICES: { value: ThemePreference; label: () => string }[] = [
    { value: 'system', label: m.param_theme_system },
    { value: 'light', label: m.param_theme_light },
    { value: 'dark', label: m.param_theme_dark },
  ];

  let showChangePhotoModal = $state(false);

  let isAdmin = $state<boolean>(false);

  let uploadStatus = $state<string>('');
  let assetId = $state<string | null>(null);
  let tagAssetId = $state<string>('');
  let tagOpStatus = $state<string>('');
  let assetDescription = $state<string>('');
  let personId = $state<string | null>(null);

  let isProcessing = $state<boolean>(false);
  let needsNewPhoto = $state<boolean>(false);
  let detectionTimeout = $state<boolean>(false);
  let abortController: AbortController | null = null;

  let showDeleteAccountModal = $state<boolean>(false);
  let deleteConfirmText = $state<string>('');
  let isDeletingAccount = $state<boolean>(false);
  let showFaceAlreadyAssignedModal = $state<boolean>(false);

  let showUnlinkFaceModal = $state<boolean>(false);
  let isUnlinkingFace = $state<boolean>(false);
  let currentUserHasFace = $state<boolean>(false);

  interface PhotoPermission {
    authorized_id: string;
    authorized_name: string;
    authorized_first_name: string | null;
    authorized_last_name: string | null;
    authorized_promo: number | null;
    authorized_formation: string | null;
    created_at: string;
  }
  interface SharedWithMe {
    owner_id: string;
    owner_name: string;
    owner_first_name: string | null;
    owner_last_name: string | null;
    owner_promo: number | null;
    owner_formation: string | null;
    created_at: string;
  }
  let photoPermissions = $state<PhotoPermission[]>([]);
  let sharedWithMe = $state<SharedWithMe[]>([]);
  let newAuthUserId = $state<string>('');
  let isAddingPermission = $state<boolean>(false);
  let isLoadingPermissions = $state<boolean>(false);
  let isLoadingSharedWithMe = $state<boolean>(false);

  interface AvailableUser {
    id_user: string;
    name: string;
    first_name: string | null;
    last_name: string | null;
    formation: string | null;
    promo: number | null;
  }

  let availableUsers = $state<AvailableUser[]>([]);
  let isLoadingAvailableUsers = $state<boolean>(false);
  let searchQuery = $state<string>('');
  let showUserDropdown = $state<boolean>(false);

  // Ranked best-first: this dropdown is what somebody types a colleague's name into, so the
  // closest match belongs at the top rather than wherever the roster happened to put them.
  const matchingUsers = $derived(
    fuzzySearch(availableUsers, searchQuery, (u) =>
      [u.name, u.first_name, u.last_name, u.formation, u.promo != null ? String(u.promo) : '']
        .filter(Boolean)
        .join(' ')
    )
  );

  $effect(() => {
    loadCurrentUserFaceStatus();
    loadPhotoPermissions();
    loadSharedWithMe();
    loadAvailableUsers();
    try {
      const u = page.data.session?.user as User | undefined;
      isAdmin = !!(u && u.role === 'admin');
    } catch {
      isAdmin = false;
    }
  });

  onDestroy(() => photosState.cleanup());

  async function handlePhotoSelected(assetId: string) {
    const u = page.data.session?.user as User | undefined;
    if (!u?.photos_id) {
      toast.error(m.param_no_immich_link());
      return;
    }

    const updateRes = await fetch(`/api/immich/people/${u.photos_id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ featureFaceAssetId: assetId }),
    });

    if (!updateRes.ok) {
      const txt = await updateRes.text().catch(() => updateRes.statusText);
      throw new Error(txt || m.param_photo_update_error());
    }

    // Persist the backing asset id so /api/users/{id}/avatar serves our own
    // square crop instead of Immich's. Best-effort (see mes-photos handler).
    try {
      await fetch('/api/users/me/face', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ person_id: u.photos_id, photos_asset_id: assetId }),
      });
    } catch (e) {
      console.warn('Failed to persist profile asset id', e);
    }

    toast.success(m.param_photo_updated());
    window.location.reload();
  }

  async function loadCurrentUserFaceStatus() {
    try {
      const response = await fetch('/api/users/me');
      const data = (await response.json()) as {
        success?: boolean;
        user?: { photos_id?: string | null };
      };
      if (data.success && data.user) {
        currentUserHasFace = !!data.user.photos_id;
        personId = data.user.photos_id ?? null;
      }
    } catch {
      /* Ignore */
    }
  }

  async function loadPhotoPermissions() {
    isLoadingPermissions = true;
    try {
      const response = await fetch('/api/users/me/photo-access');
      const data = (await response.json()) as {
        success?: boolean;
        permissions?: PhotoPermission[];
      };
      if (data.success && data.permissions) {
        photoPermissions = data.permissions;
      }
    } catch {
      /* Ignore */
    } finally {
      isLoadingPermissions = false;
    }
  }

  async function loadAvailableUsers() {
    isLoadingAvailableUsers = true;
    try {
      const response = await fetch('/api/users/me/photo-access/options');
      const data = (await response.json()) as { success?: boolean; users?: AvailableUser[] };
      if (data.success && data.users) {
        availableUsers = data.users;
      }
    } catch (e) {
      /* Ignore load error */
    } finally {
      isLoadingAvailableUsers = false;
    }
  }

  async function loadSharedWithMe() {
    isLoadingSharedWithMe = true;
    try {
      const response = await fetch('/api/users/me/photo-access/shared-with-me');
      const data = (await response.json()) as { success?: boolean; shared_by?: SharedWithMe[] };
      if (data.success && data.shared_by) {
        sharedWithMe = data.shared_by;
      }
    } catch {
      /* Ignore */
    } finally {
      isLoadingSharedWithMe = false;
    }
  }

  async function addPhotoPermission() {
    if (!newAuthUserId.trim()) {
      toast.error(m.param_select_user());
      return;
    }
    isAddingPermission = true;
    try {
      const response = await fetch('/api/users/me/photo-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: newAuthUserId.trim() }),
      });
      const data = (await response.json()) as {
        success?: boolean;
        error?: string;
        message?: string;
      };
      if (data.success) {
        toast.success(data.message || m.param_auth_added());
        newAuthUserId = '';
        searchQuery = '';
        showUserDropdown = false;
        await loadPhotoPermissions();
      } else {
        toast.error(data.error || m.param_add_error());
      }
    } catch (e) {
      toast.error(
        m.common_error_detail({ error: e instanceof Error ? e.message : m.common_unknown_error() })
      );
    } finally {
      isAddingPermission = false;
    }
  }

  async function revokePhotoPermission(userId: string) {
    try {
      const response = await fetch('/api/users/me/photo-access', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId }),
      });
      const data = (await response.json()) as { success?: boolean; error?: string };
      if (data.success) {
        toast.success(m.param_auth_revoked());
        await loadPhotoPermissions();
      } else {
        toast.error(data.error || m.param_revoke_error());
      }
    } catch (e) {
      toast.error(
        m.common_error_detail({ error: e instanceof Error ? e.message : m.common_unknown_error() })
      );
    }
  }

  async function unlinkMyFace() {
    isUnlinkingFace = true;
    try {
      const response = await fetch('/api/users/me/face', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ person_id: null }),
      });
      const data = (await response.json()) as { success?: boolean; error?: string };
      if (data.success) {
        toast.success(m.param_face_unlinked());
        showUnlinkFaceModal = false;
        currentUserHasFace = false;
        personId = null;
      } else {
        toast.error(m.common_error_detail({ error: data.error || m.common_unknown_error() }));
      }
    } catch (e) {
      toast.error(
        m.common_error_detail({ error: e instanceof Error ? e.message : m.common_unknown_error() })
      );
    } finally {
      isUnlinkingFace = false;
    }
  }

  async function checkForPeople(
    shouldDeleteAfter: boolean = false,
    assetIdToDelete: string | null = null,
    isTimeoutCheck: boolean = false
  ) {
    const userId = (page.data.session?.user as User)?.id_user;
    if (!userId || !assetId) {
      return;
    }
    let shouldCleanup = shouldDeleteAfter && assetIdToDelete;

    try {
      uploadStatus = m.param_status_fetching();
      const assetInfoResponse = await fetch(`/api/immich/assets/${assetId}`);
      if (!assetInfoResponse.ok) {
        const errMsg = `Asset fetch error: ${assetInfoResponse.statusText}`;
        throw new Error(errMsg);
      }
      const assetInfoData = await assetInfoResponse.json();
      const assetInfo = assetInfoData as { people?: Array<{ id: string }> };
      const people = assetInfo.people || [];

      uploadStatus = m.param_status_detected_count({ count: people.length });

      if (people.length === 1) {
        personId = people[0].id;
        uploadStatus = m.param_status_saving();

        const updateResponse = await fetch('/api/users/me/face', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ person_id: personId }),
        });
        const updateData = (await updateResponse.json()) as {
          success?: boolean;
          error?: string;
          message?: string;
        };

        if (updateData.error === 'face_already_assigned') {
          uploadStatus = m.param_status_face_taken();
          showFaceAlreadyAssignedModal = true;
          if (shouldCleanup) {
            try {
              await cleanupAsset(assetIdToDelete);
            } catch (e) {
              /* Ignore cleanup error */
            }
          }
          return;
        }

        if (updateData.success) {
          uploadStatus = m.param_face_ok();
          if (shouldCleanup) {
            try {
              await cleanupAsset(assetIdToDelete);
            } catch (e) {
              /* Ignore cleanup error */
            }
          }
          isProcessing = false;
          // Increase delay to give DB time to sync
          await new Promise((resolve) => setTimeout(resolve, 1500));
          window.location.reload();
        } else {
          uploadStatus = m.param_db_update_error({
            error: updateData.error || m.common_unknown_error(),
          });
          if (shouldCleanup) {
            try {
              await cleanupAsset(assetIdToDelete);
            } catch (e) {
              /* Ignore cleanup error */
            }
          }
        }
      } else if (people.length === 0) {
        // Distinguish actual "no face" vs "timeout"
        if (isTimeoutCheck) {
          uploadStatus = m.param_status_timeout();
          detectionTimeout = true;
        } else {
          uploadStatus = m.param_status_no_face();
        }
        if (shouldCleanup) {
          try {
            await cleanupAsset(assetIdToDelete);
          } catch (e) {
            console.warn('Cleanup failed:', e);
          }
        }
      } else {
        uploadStatus = m.param_status_multi_count({ count: people.length });
        needsNewPhoto = true;
        if (shouldCleanup) {
          try {
            await cleanupAsset(assetIdToDelete);
          } catch (e) {
            console.warn('Cleanup failed:', e);
          }
        }
      }
    } catch (error: unknown) {
      uploadStatus = m.common_error_detail({
        error: error instanceof Error ? error.message : m.common_unknown_error(),
      });
      if (shouldCleanup) {
        try {
          await cleanupAsset(assetIdToDelete);
        } catch (e) {
          /* Ignore cleanup error */
        }
      }
    }
  }

  async function cleanupAsset(id: string | null) {
    if (!id) {
      return;
    }
    const response = await fetch(`/api/immich/assets`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'X-Face-Pairing-Cleanup': 'true',
      },
      body: JSON.stringify({ ids: [id] }),
    });
    if (!response.ok) {
      const errMsg = `Cleanup failed: ${response.status} ${response.statusText}. Photo may not be deleted from Immich.`;
      throw new Error(errMsg);
    }
  }

  async function importPhoto(file: File) {
    if (!file) return;
    const userId = (page.data.session?.user as User)?.id_user;
    if (!userId) {
      toast.error(m.param_no_user());
      return;
    }

    isProcessing = true;
    detectionTimeout = false;
    uploadStatus = m.param_status_uploading();
    assetId = null;
    personId = null;
    needsNewPhoto = false;
    abortController = new AbortController();
    const signal = abortController.signal;

    let isDuplicate = false;
    let uploadedAssetId: string | null = null;

    try {
      let uploadResponse: Response;
      uploadResponse = await uploadFileChunked(file, signal);

      if (!uploadResponse.ok) {
        const errMsg = `Upload error: ${uploadResponse.statusText}`;
        throw new Error(errMsg);
      }
      const uploadData = (await uploadResponse.json()) as Record<string, unknown>;

      if (uploadData.status === 'duplicate' && uploadData.id) {
        isDuplicate = true;
        uploadedAssetId = String(uploadData.id);
        uploadStatus = m.param_status_existing();
      } else if (uploadData.duplicateId) {
        isDuplicate = true;
        uploadedAssetId = String(uploadData.duplicateId);
        uploadStatus = m.param_status_existing();
      } else if (uploadData.id) {
        uploadedAssetId = String(uploadData.id);
      } else {
        throw new Error(m.param_no_id_returned());
      }

      assetId = uploadedAssetId;

      // Increase to 60 seconds to give Immich time to process
      const maxAttempts = 60;
      let attempt = 0;
      let faceDetected = false;
      while (attempt < maxAttempts && !faceDetected) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        attempt++;
        uploadStatus = m.param_status_analyzing({ seconds: attempt });
        try {
          const checkResponse = await fetch(`/api/immich/assets/${assetId}?nocache=${Date.now()}`, {
            signal,
          });
          if (checkResponse.ok) {
            const checkData = await checkResponse.json();
            if (checkData.people && checkData.people.length > 0) {
              faceDetected = true;
              break;
            }
          }
        } catch (err: unknown) {
          if (err instanceof Error && err.name === 'AbortError') throw err;
        }
      }

      const shouldDeleteAfter = !isDuplicate && !!uploadedAssetId;
      // Pass the isTimeoutCheck=true flag if we reached max attempts
      const isTimeout = attempt >= maxAttempts && !faceDetected;
      await checkForPeople(shouldDeleteAfter, uploadedAssetId, isTimeout);
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }
      if (!isDuplicate && uploadedAssetId) {
        try {
          await cleanupAsset(uploadedAssetId);
        } catch (e) {
          /* Ignore cleanup error */
        }
      }
      uploadStatus = m.common_error_detail({
        error: error instanceof Error ? error.message : m.common_unknown_error(),
      });
    } finally {
      isProcessing = false;
      abortController = null;
    }
  }

  $effect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isProcessing && abortController) {
        abortController.abort();
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  });

  async function deleteMyAccount() {
    if (deleteConfirmText !== 'CONFIRMATION') {
      toast.error(m.param_type_confirmation());
      return;
    }
    isDeletingAccount = true;
    try {
      const response = await fetch('/api/users/me', { method: 'DELETE' });
      const data = (await response.json()) as { success?: boolean; error?: string };
      if (data.success) {
        toast.success(m.param_account_deleted());
        showDeleteAccountModal = false;
        setTimeout(() => {
          goto('/api/auth/signout');
        }, 1000);
      } else {
        toast.error(data.error || m.common_unknown_error());
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : m.common_unknown_error());
    } finally {
      isDeletingAccount = false;
    }
  }

  function openDeleteAccountModal() {
    deleteConfirmText = '';
    showDeleteAccountModal = true;
  }
</script>

<svelte:head>
  <title>{m.param_page_title()}</title>
</svelte:head>

<!-- A div, not a <main>: the layout's <main> is the landmark and the ONE page container - it
alone sets the width and the gutter, which this page used to add a second time (ui-redesign #10). -->
<div class="settings-main">
  <BackgroundBlobs />

  <div class="settings-container">
    <PageHeader title={m.nav_settings()} />

    <section class="settings-group">
      <h2 class="group-title">{m.param_profile()}</h2>
      <div class="group-card">
        <SettingsRow
          icon={Camera}
          title={m.param_profile_photo()}
          description={currentUserHasFace
            ? m.param_profile_photo_desc()
            : m.param_need_face_first()}
          onclick={() => (showChangePhotoModal = true)}
          disabled={!currentUserHasFace}
        />
      </div>
    </section>

    <section class="settings-group">
      <h2 class="group-title">{m.param_appearance()}</h2>
      <div class="group-card">
        <SettingsRow icon={Palette} title={m.param_theme_label()}>
          <div class="segmented" role="radiogroup" aria-label={m.param_theme_label()}>
            {#each THEME_CHOICES as choice (choice.value)}
              <button
                type="button"
                role="radio"
                aria-checked={$theme === choice.value}
                class:active={$theme === choice.value}
                onclick={() => theme.set(choice.value)}
              >
                {choice.label()}
              </button>
            {/each}
          </div>
        </SettingsRow>
        <SettingsRow icon={Languages} title={m.param_language()}>
          <select
            class="lang-select"
            value={getLocale()}
            onchange={(e) => switchLocale((e.currentTarget as HTMLSelectElement).value as Locale)}
            aria-label={m.param_language()}
          >
            <option value="fr">{m.lang_french()}</option>
            <option value="en">{m.lang_english()}</option>
          </select>
        </SettingsRow>
      </div>
    </section>

    <section id="face-recognition" class="settings-group">
      <h2 class="group-title">{m.param_face_title()}</h2>
      <p class="group-desc">{m.param_face_sub()}</p>
      <div class="group-card group-body">
        <!-- The icon is the flex row's first child, not inside the <p>: lucide's svg is a block, so
             in the text it took a line of its own above it (user, 2026-09-26). -->
        <div class="info-box">
          <Info size={18} class="info-box-icon" />
          <p>
            {m.param_face_note_before()}
            <strong>{m.param_face_note_strong()}</strong>
            {m.param_face_note_after()}
          </p>
        </div>

        <div class="camera-section">
          <div class="camera-wrapper">
            <CameraInput onPhoto={importPhoto} disabled={isProcessing} />
          </div>

          <div class="camera-status">
            {#if isProcessing}
              <div class="status-processing">
                <Spinner size={20} /> <span>{uploadStatus}</span>
              </div>
            {:else if assetId && !needsNewPhoto && !detectionTimeout}
              <div class="status-success">
                <CircleCheckBig size={20} />
                <span>{m.param_face_ok()}</span>
              </div>
            {:else if needsNewPhoto}
              <div class="status-error">
                <CircleAlert size={20} />
                <div class="error-message">
                  <span>{m.param_face_multi()}</span>
                  <p class="text-sm">{uploadStatus}</p>
                  <button
                    type="button"
                    onclick={() => {
                      assetId = null;
                      needsNewPhoto = false;
                      detectionTimeout = false;
                      uploadStatus = '';
                    }}
                    class="retry-link"
                  >
                    {m.common_retry()}
                  </button>
                </div>
              </div>
            {:else if detectionTimeout}
              <div class="status-warning">
                <TriangleAlert size={20} />
                <div class="error-message">
                  <span>{uploadStatus}</span>
                  <button
                    type="button"
                    onclick={() => {
                      assetId = null;
                      detectionTimeout = false;
                      uploadStatus = '';
                    }}
                    class="retry-link"
                  >
                    {m.common_retry()}
                  </button>
                </div>
              </div>
            {:else if uploadStatus && !isProcessing}
              <div class="status-error">
                <CircleAlert size={20} />
                <div class="error-message">
                  <span>{uploadStatus}</span>
                  <button
                    type="button"
                    onclick={() => {
                      assetId = null;
                      needsNewPhoto = false;
                      detectionTimeout = false;
                      uploadStatus = '';
                    }}
                    class="retry-link"
                  >
                    {m.common_retry()}
                  </button>
                </div>
              </div>
            {:else}
              <p class="text-hint">{m.param_face_hint()}</p>
            {/if}
          </div>
        </div>
      </div>
    </section>

    {#if currentUserHasFace}
      <section class="settings-group">
        <h2 class="group-title">{m.param_share_title()}</h2>
        <p class="group-desc">{m.param_share_sub()}</p>
        <div class="group-card group-body">
          <div class="permission-add-row">
            <div class="user-selector">
              <input
                type="text"
                bind:value={searchQuery}
                placeholder={m.param_search_profile()}
                class="settings-input selector-input"
                disabled={isAddingPermission || isLoadingAvailableUsers}
                oninput={() => {
                  // Typing invalidates any previously picked user so we never
                  // authorize a stale selection that no longer matches the text.
                  newAuthUserId = '';
                  showUserDropdown = true;
                }}
                onfocus={() => {
                  showUserDropdown = true;
                  if (availableUsers.length === 0) loadAvailableUsers();
                }}
                onblur={() => {
                  setTimeout(() => {
                    showUserDropdown = false;
                  }, 200);
                }}
              />
              {#if showUserDropdown && availableUsers.length > 0}
                <div class="user-dropdown">
                  {#if isLoadingAvailableUsers}
                    <div class="dropdown-loading"><Spinner size={16} /> {m.common_loading()}</div>
                  {:else}
                    {#each matchingUsers as user (user.id_user)}
                      <button
                        type="button"
                        class="dropdown-item"
                        onclick={() => {
                          newAuthUserId = user.id_user;
                          searchQuery = user.name;
                          showUserDropdown = false;
                        }}
                        disabled={isAddingPermission}
                      >
                        <div class="user-item-content">
                          <div class="user-item-name">{user.name}</div>
                          {#if user.formation || user.promo}
                            <div class="user-item-meta">
                              {#if user.promo}{user.promo}{/if}
                              {#if user.formation}
                                {#if user.promo}•{/if}
                                {user.formation}
                              {/if}
                            </div>
                          {/if}
                        </div>
                      </button>
                    {/each}
                  {/if}
                </div>
              {/if}
            </div>
            <button
              type="button"
              onclick={addPhotoPermission}
              class="btn primary"
              disabled={isAddingPermission || !newAuthUserId.trim()}
            >
              {#if isAddingPermission}<Spinner size={16} />{/if}
              <span>{m.param_authorize()}</span>
            </button>
          </div>

          <div class="permissions-container">
            {#if isLoadingPermissions}
              <div class="loading-state"><Spinner size={20} /> {m.common_loading()}</div>
            {:else if photoPermissions.length > 0}
              <div class="person-list">
                {#each photoPermissions as perm (perm.authorized_id)}
                  <div class="person-row">
                    <Avatar
                      userId={perm.authorized_id}
                      firstName={perm.authorized_first_name}
                      lastName={perm.authorized_last_name}
                      name={perm.authorized_name}
                    />
                    <div class="person-info">
                      <span class="person-name">{perm.authorized_name}</span>
                      <span class="person-meta">
                        {#if perm.authorized_promo}<span class="person-promo"
                            >{perm.authorized_promo}</span
                          >{/if}
                        {m.param_since_date({
                          date: new Date(perm.created_at).toLocaleDateString(getLocale()),
                        })}
                      </span>
                    </div>
                    <button
                      type="button"
                      class="person-action-btn"
                      onclick={() => revokePhotoPermission(perm.authorized_id)}
                      title={m.param_revoke_access()}
                      aria-label={m.param_revoke_access()}
                    >
                      <X size={16} />
                    </button>
                  </div>
                {/each}
              </div>
            {:else}
              <p class="group-empty">{m.param_no_auth()}</p>
            {/if}
          </div>
        </div>
      </section>
    {/if}

    <section class="settings-group">
      <h2 class="group-title">{m.param_shared_title()}</h2>
      <p class="group-desc">{m.param_shared_sub()}</p>
      <div class="group-card group-body">
        {#if isLoadingSharedWithMe}
          <div class="loading-state"><Spinner size={20} /> {m.common_loading()}</div>
        {:else if sharedWithMe.length > 0}
          <div class="person-list">
            {#each sharedWithMe as shared (shared.owner_id)}
              <a href="/mes-photos?userId={shared.owner_id}" class="person-row person-row-link">
                <Avatar
                  userId={shared.owner_id}
                  firstName={shared.owner_first_name}
                  lastName={shared.owner_last_name}
                  name={shared.owner_name}
                />
                <div class="person-info">
                  <span class="person-name">{shared.owner_name}</span>
                  <span class="person-meta">
                    {#if shared.owner_promo}<span class="person-promo">{shared.owner_promo}</span
                      >{/if}
                    {m.param_since_date({
                      date: new Date(shared.created_at).toLocaleDateString(getLocale()),
                    })}
                  </span>
                </div>
                <span class="person-chevron"><ChevronRight size={18} /></span>
              </a>
            {/each}
          </div>
        {:else}
          <p class="group-empty">{m.param_no_shared()}</p>
        {/if}
      </div>
    </section>

    {#if isAdmin}
      <section class="settings-group">
        <h2 class="group-title">{m.param_admin_title()}</h2>
        <div class="group-card">
          <SettingsRow
            icon={Shield}
            title={m.param_admin_open()}
            description={m.param_admin_open_desc()}
            href="/admin"
          />
        </div>
      </section>
    {/if}

    <section class="settings-group">
      <h2 class="group-title">{m.param_account_title()}</h2>
      <div class="group-card">
        {#if currentUserHasFace}
          <SettingsRow
            icon={ScanEye}
            title={m.param_unlink_face()}
            description={m.param_unlink_face_desc()}
            onclick={() => (showUnlinkFaceModal = true)}
            danger
          />
        {/if}
        <SettingsRow
          icon={Trash2}
          title={m.param_delete_account()}
          description={m.param_delete_account_desc()}
          onclick={openDeleteAccountModal}
          danger
        />
      </div>
    </section>

    <footer class="settings-footer">
      <div class="footer-links">
        <a href="https://mitv.fr" target="_blank">MiTV</a> •
        <a href="/cgu">{m.param_terms()}</a> •
        <a href="mailto:bureau@mitv.fr">Contact</a>
      </div>
      <p class="copyright">{m.param_copyright()}</p>
    </footer>
  </div>
</div>

<Modal
  bind:show={showDeleteAccountModal}
  title={m.param_delete_account_title()}
  type="warning"
  icon="alert-triangle"
  confirmText={isDeletingAccount ? m.param_deleting() : m.param_delete_permanent()}
  cancelText={m.common_cancel()}
  confirmDisabled={deleteConfirmText !== 'CONFIRMATION' || isDeletingAccount}
  onConfirm={deleteMyAccount}
  onCancel={() => {
    showDeleteAccountModal = false;
    deleteConfirmText = '';
  }}
>
  <div class="modal-content">
    <p class="text-danger mb-4 font-bold">{m.param_delete_irreversible()}</p>
    <p class="mb-4">
      {m.param_type_confirm_prefix()} <strong>CONFIRMATION</strong>
      {m.param_type_confirm_suffix()}
    </p>
    <input
      type="text"
      bind:value={deleteConfirmText}
      placeholder={m.param_type_confirm_placeholder()}
      class="settings-input w-full"
      disabled={isDeletingAccount}
    />
  </div>
</Modal>

<Modal
  bind:show={showUnlinkFaceModal}
  title={m.param_unlink_face()}
  type="warning"
  icon="user-x"
  confirmText={isUnlinkingFace ? m.param_unlinking() : m.param_unlink()}
  cancelText={m.common_cancel()}
  confirmDisabled={isUnlinkingFace}
  onConfirm={unlinkMyFace}
  onCancel={() => {
    showUnlinkFaceModal = false;
  }}
>
  <p>{m.param_unlink_confirm()}</p>
</Modal>

<Modal
  bind:show={showFaceAlreadyAssignedModal}
  title={m.param_face_taken_title()}
  type="warning"
  icon="alert-circle"
  confirmText={m.param_confirm_understood()}
  onConfirm={() => {
    showFaceAlreadyAssignedModal = false;
  }}
>
  <p>{m.param_face_taken_body()}</p>
</Modal>

{#if showChangePhotoModal}
  <ChangePhotoModal
    peopleId={personId ?? undefined}
    onClose={() => (showChangePhotoModal = false)}
    onPhotoSelected={handlePhotoSelected}
  />
{/if}

<style>
  /*
	 * One height for every control this page owns. Each of them used to size itself from its own
	 * padding, so a button, a select and an input sharing a row came out three different heights -
	 * most visibly the theme button beside the language select, and the search field beside
	 * "Autoriser". Padding still varies with the content; the height does not.
	 *
	 * It is declared on :root and not on .settings-main because this page's modals are rendered in
	 * a <dialog> that is a SIBLING of that element, not a descendant: a custom property cascades by
	 * DOM ancestry, so scoping it to the main would have left every control inside a modal silently
	 * unstyled - which is exactly what it did until the delete-account field was measured.
	 */
  :root {
    --st-control-height: 2.75rem;
  }

  .settings-main {
    position: relative;
    min-height: 100vh;
    padding: 0.5rem 0 6rem;
    color: var(--text-primary);
    overflow-x: hidden;
  }

  /* A readable column, flush with the other pages' left edge (Google Photos' settings are a
     left-aligned list too); the gutter is the layout's alone. */
  .settings-container {
    position: relative;
    z-index: 1;
    max-width: 720px;
  }

  /* A group: a small heading, an optional line of context, then one flat card of rows. */
  .settings-group {
    margin-bottom: 1.75rem;
  }

  .group-title {
    margin: 0 0 0.5rem 1rem;
    color: var(--text-secondary);
    font-size: 0.8125rem;
    font-weight: 600;
    letter-spacing: 0.02em;
  }

  .group-desc {
    margin: -0.25rem 0 0.625rem 1rem;
    color: var(--text-muted);
    font-size: 0.8125rem;
  }

  .group-card {
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--bg-secondary);
  }

  /* Rows are separated by a hairline inset past the icon, as in a native list. */
  .group-card > :global(.settings-row + .settings-row) {
    border-top: 1px solid var(--border);
  }

  /* A group holding free content (face recognition, sharing) rather than rows. */
  .group-body {
    padding: 1rem;
  }

  /* Nothing to list is one quiet line, not an illustration: the heading already says what it is. */
  .group-empty {
    margin: 0;
    color: var(--text-secondary);
    font-size: 0.875rem;
  }

  /* The theme: three choices, one tap each - the old button showed the OPPOSITE of the theme in
     force, so "Mode Clair" read as a state and acted as an action. */
  .segmented {
    display: inline-flex;
    padding: 0.1875rem;
    border-radius: 999px;
    background: var(--bg-tertiary);
  }

  .segmented button {
    min-height: 2rem;
    padding: 0 0.875rem;
    border-radius: 999px;
    background: none;
    color: var(--text-secondary);
    font-size: 0.8125rem;
    font-weight: 500;
  }

  .segmented button.active {
    background: var(--bg-elevated);
    color: var(--text-primary);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
  }

  .lang-select {
    min-height: 2.25rem;
    padding: 0 0.75rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--bg-primary);
    color: var(--text-primary);
    font: inherit;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
  }

  .info-box {
    display: flex;
    gap: 0.75rem;
    background: rgba(59, 130, 246, 0.1);
    color: var(--text-primary);
    padding: 1rem;
    border-radius: var(--radius-md);
    font-size: 0.95rem;
    margin-bottom: 1.5rem;
  }
  .info-box p {
    margin: 0;
    line-height: 1.5;
  }
  /* Centred on the first line of text (0.95rem x 1.5 = ~23px line, 18px icon). */
  .info-box :global(.info-box-icon) {
    flex-shrink: 0;
    margin-top: 0.15rem;
    color: var(--accent);
  }

  .camera-section {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
  }
  .camera-status {
    text-align: center;
  }
  .status-processing {
    color: var(--accent);
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .status-success {
    color: var(--success);
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-weight: 500;
  }
  .status-error {
    color: var(--error);
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-weight: 500;
  }
  .status-warning {
    color: var(--warning);
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-weight: 500;
  }
  .error-message {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
  }
  .text-hint {
    color: var(--text-secondary);
    font-size: 0.9rem;
  }

  /* --- FORMS & INPUTS --- */
  .settings-input {
    min-height: var(--st-control-height);
    padding: 0.5rem 1rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-xs);
    background: var(--bg-primary);
    color: var(--text-primary);
    outline: none;
    transition: border-color 0.2s;
  }
  .settings-input:focus {
    border-color: var(--accent);
  }
  .settings-input:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .permission-add-row {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1.5rem;
    /* Both controls are one height now, so centring them actually lines them up. */
    align-items: center;
  }

  .user-selector {
    flex: 1;
    position: relative;
  }

  .selector-input {
    width: 100%;
  }

  .user-dropdown {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-top: none;
    border-radius: 0 0 var(--radius-xs) var(--radius-xs);
    max-height: 300px;
    overflow-y: auto;
    z-index: 10;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
  }

  .dropdown-loading {
    padding: 1rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: var(--text-secondary);
    justify-content: center;
  }

  .dropdown-item {
    width: 100%;
    padding: 0.75rem 1rem;
    border: none;
    background: none;
    text-align: left;
    cursor: pointer;
    color: var(--text-primary);
    font-size: 0.95rem;
    transition: background-color 0.2s;
  }

  .dropdown-item:hover:not(:disabled) {
    background: var(--bg-primary);
  }

  .dropdown-item:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .user-item-content {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .user-item-name {
    font-weight: 500;
    color: var(--text-primary);
  }

  .user-item-meta {
    font-size: 0.85rem;
    color: var(--text-secondary);
  }

  .permission-add-row input {
    flex: 1;
  }

  /* Inline retry action inside face-detection status boxes. */
  .retry-link {
    margin-top: 0.5rem;
    align-self: flex-start;
    background: none;
    border: none;
    padding: 0;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--accent);
    cursor: pointer;
  }
  .retry-link:hover {
    color: var(--accent-hover);
    text-decoration: underline;
  }

  /* --- PERSON LIST (shared by "authorized people" and "shared with me") --- */
  .person-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .person-row {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    padding: 0.6rem 0.75rem;
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    text-decoration: none;
    transition: all 0.2s var(--ease);
  }
  .person-row-link:hover {
    border-color: var(--accent);
    transform: translateX(2px);
  }
  .person-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    line-height: 1.25;
  }
  .person-name {
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .person-meta {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.78rem;
    color: var(--text-secondary);
  }
  .person-promo {
    padding: 0.05rem 0.4rem;
    border-radius: 99px;
    background: var(--accent-light);
    color: var(--accent);
    font-weight: 600;
  }
  .person-action-btn {
    flex-shrink: 0;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-secondary);
    padding: 6px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s var(--ease);
  }
  .person-action-btn:hover {
    background: color-mix(in srgb, var(--error) 15%, transparent);
    color: var(--error);
  }
  .person-chevron {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    color: var(--text-muted);
  }

  /* --- FOOTER --- */
  .settings-footer {
    text-align: center;
    margin-top: 4rem;
    color: var(--text-secondary);
  }
  .footer-links a:hover {
    color: var(--accent);
  }
  .copyright {
    font-size: 0.85rem;
    margin-top: 0.5rem;
    opacity: 0.7;
  }

  @media (max-width: 640px) {
    .segmented button {
      padding: 0 0.625rem;
    }
  }
</style>
