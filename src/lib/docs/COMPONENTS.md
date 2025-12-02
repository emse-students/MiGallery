# Guide des Composants

Ce document décrit les composants réutilisables de l'application MiGallery.

## Composants UI

### Modal.svelte

Modal générique supportant plusieurs types d'affichage.

```svelte
<Modal
  bind:show={showModal}
  title="Titre du modal"
  type="confirm"           <!-- 'default' | 'confirm' | 'warning' | 'danger' -->
  icon="alert-circle"      <!-- Nom de l'icône Lucide (optionnel) -->
  confirmText="Confirmer"  <!-- Texte du bouton de confirmation -->
  cancelText="Annuler"     <!-- Texte du bouton d'annulation -->
  confirmDisabled={false}  <!-- Désactiver le bouton de confirmation -->
  showCloseButton={true}   <!-- Afficher le bouton X -->
  onConfirm={() => {}}     <!-- Callback de confirmation -->
  onCancel={() => {}}      <!-- Callback d'annulation -->
>
  {#snippet children()}
    <p>Contenu du modal</p>
  {/snippet}
</Modal>
```

**Props:**
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `show` | `boolean` | `true` | Contrôle l'affichage (bindable) |
| `title` | `string` | `''` | Titre du modal |
| `type` | `string` | `'default'` | Type de modal (affecte les couleurs) |
| `icon` | `string` | - | Icône à afficher dans le header |
| `confirmText` | `string` | `'Confirmer'` | Texte du bouton principal |
| `cancelText` | `string` | `'Annuler'` | Texte du bouton secondaire |
| `confirmDisabled` | `boolean` | `false` | Désactive le bouton de confirmation |
| `showCloseButton` | `boolean` | `true` | Affiche le bouton de fermeture |
| `onConfirm` | `function` | - | Callback appelé à la confirmation |
| `onCancel` | `function` | - | Callback appelé à l'annulation |

---

### Icon.svelte

Wrapper pour les icônes Lucide.

```svelte
<Icon name="folder" size={24} class="custom-class" />
```

**Props:**
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `name` | `string` | - | Nom de l'icône Lucide |
| `size` | `number` | `24` | Taille en pixels |
| `class` | `string` | `''` | Classes CSS additionnelles |

**Icônes disponibles:** folder, user, camera, trash, settings, edit, download, share, check-square, x, alert-circle, image, chevron-left, users, plus, etc.

---

### PhotosGrid.svelte

Grille de photos avec mode sélection et modal de visualisation.

```svelte
<PhotosGrid
  state={photosState}      <!-- Instance de PhotosState -->
  visibility="private"     <!-- Visibilité de l'album -->
  albumId="123"            <!-- ID de l'album (optionnel) -->
  onModalClose={(changed) => {}} <!-- Callback après fermeture du modal photo -->
/>
```

**PhotosState (classe):**

```typescript
class PhotosState {
	assets: Asset[]; // Liste des photos
	loading: boolean; // Chargement en cours
	error: string | null; // Message d'erreur
	selecting: boolean; // Mode sélection actif
	selected: Set<string>; // IDs des photos sélectionnées
	isDownloading: boolean; // Téléchargement en cours
	downloadProgress: number; // Progression (0-1)

	// Méthodes
	loadAlbumWithStreaming(immichId, name?, visibility?): Promise<void>;
	toggleSelect(id: string): void;
	selectAll(): void;
	clearSelection(): void;
}
```

---

### Toast.svelte / ToastContainer.svelte

Système de notifications.

```typescript
import { toast } from '$lib/toast';

// Usage
toast.success('Opération réussie');
toast.error('Une erreur est survenue');
toast.info('Information');
toast.warning('Attention');
```

---

### Spinner.svelte

Indicateur de chargement.

```svelte
<Spinner size={20} />
```

---

### UploadZone.svelte

Zone de drag & drop pour l'upload de fichiers.

```svelte
<UploadZone
  onUpload={(files, onProgress) => Promise<UploadResult[]>}
  accept="image/*"           <!-- Types de fichiers acceptés -->
  multiple={true}            <!-- Autoriser plusieurs fichiers -->
  maxSize={10485760}         <!-- Taille max en bytes (10MB) -->
/>
```

---

### AlbumModal.svelte

Modal de création/édition d'album.

```svelte
<AlbumModal
  albumId="123"              <!-- Si présent: mode édition -->
  onClose={() => {}}         <!-- Callback de fermeture -->
  onSuccess={() => {}}       <!-- Callback après succès -->
/>
```

---

### LazyImage.svelte

Image avec chargement différé et placeholder.

```svelte
<LazyImage
  src="/api/immich/assets/123/thumbnail"
  alt="Photo description"
  aspectRatio="1"
/>
```

---

### Skeleton.svelte

Placeholder de chargement animé.

```svelte
<Skeleton aspectRatio="1" rounded={false}>
  <!-- Contenu optionnel (icône, etc.) -->
</Skeleton>
```

---

### MobileNav.svelte

Barre de navigation mobile (fixée en bas).

Ce composant est automatiquement inclus dans le layout et s'affiche uniquement sur mobile (< 768px). Il affiche les liens de navigation principaux avec des icônes.

---

## Composants de Page

### PhotoModal.svelte

Modal plein écran pour visualiser une photo avec navigation.

### ChangePhotoModal.svelte

Modal pour changer la photo de profil d'un utilisateur.

### ConfirmHost.svelte

Host pour les dialogues de confirmation programmatiques (via `showConfirm()`).

---

## Patterns d'utilisation

### Confirmation programmatique

```typescript
import { showConfirm } from '$lib/confirm';

async function deleteItem() {
	const confirmed = await showConfirm('Voulez-vous vraiment supprimer cet élément ?', 'Supprimer');
	if (confirmed) {
		// Effectuer la suppression
	}
}
```

### Gestion des photos avec PhotosState

```typescript
import { PhotosState } from '$lib/photos.svelte';

// Dans un composant
const photosState = new PhotosState();

// Charger un album
await photosState.loadAlbumWithStreaming('album-id', 'Album Name', 'private');

// Mode sélection
photosState.selecting = true;
photosState.toggleSelect('photo-id');
const selectedIds = Array.from(photosState.selected);
```

### Notifications

```typescript
import { toast } from '$lib/toast';

try {
	await saveData();
	toast.success('Données sauvegardées');
} catch (e) {
	toast.error('Erreur: ' + e.message);
}
```
