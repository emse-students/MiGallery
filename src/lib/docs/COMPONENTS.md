# Components Guide

This document describes the reusable components of the MiGallery application.

## UI Components

### Modal.svelte

Generic modal supporting multiple display types.

```svelte
<Modal
  bind:show={showModal}
  title="Modal title"
  type="confirm"           <!-- 'default' | 'confirm' | 'warning' | 'danger' -->
  icon="alert-circle"      <!-- Lucide icon name (optional) -->
  confirmText="Confirm"    <!-- Confirm button text -->
  cancelText="Cancel"      <!-- Cancel button text -->
  confirmDisabled={false}  <!-- Disable confirm button -->
  showCloseButton={true}   <!-- Show X button -->
  onConfirm={() => {}}     <!-- Confirm callback -->
  onCancel={() => {}}      <!-- Cancel callback -->
>
  {#snippet children()}
    <p>Modal content</p>
  {/snippet}
</Modal>
```

**Props:**
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `show` | `boolean` | `true` | Controls display (bindable) |
| `title` | `string` | `''` | Modal title |
| `type` | `string` | `'default'` | Modal type (affects colors) |
| `icon` | `string` | - | Icon to display in header |
| `confirmText` | `string` | `'Confirm'` | Primary button text |
| `cancelText` | `string` | `'Cancel'` | Secondary button text |
| `confirmDisabled` | `boolean` | `false` | Disables confirm button |
| `showCloseButton` | `boolean` | `true` | Shows close button |
| `onConfirm` | `function` | - | Callback called on confirm |
| `onCancel` | `function` | - | Callback called on cancel |

---

**Available icons:** folder, user, camera, trash, settings, edit, download, share, check-square, x, alert-circle, image, chevron-left, users, plus, etc.

---

### PhotosGrid.svelte

Photo grid with selection mode and viewing modal.

```svelte
<PhotosGrid
  state={photosState}      <!-- PhotosState instance -->
  visibility="private"     <!-- Album visibility -->
  albumId="123"            <!-- Album ID (optional) -->
  onModalClose={(changed) => {}} <!-- Callback after photo modal close -->
/>
```

**PhotosState (class):**

```typescript
class PhotosState {
	assets: Asset[]; // Photo list
	loading: boolean; // Loading in progress
	error: string | null; // Error message
	selecting: boolean; // Selection mode active
	selected: Set<string>; // Selected photo IDs
	isDownloading: boolean; // Download in progress
	downloadProgress: number; // Progress (0-1)

	// Methods
	loadAlbumWithStreaming(immichId, name?, visibility?): Promise<void>;
	toggleSelect(id: string): void;
	selectAll(): void;
	clearSelection(): void;
}
```

---

### Toast.svelte / ToastContainer.svelte

Notification system.

```typescript
import { toast } from '$lib/toast';

// Usage
toast.success('Operation successful');
toast.error('An error occurred');
toast.info('Information');
toast.warning('Warning');
```

---

### Spinner.svelte

Loading indicator.

```svelte
<Spinner size={20} />
```

---

### UploadZone.svelte

Drag & drop zone for file upload.

```svelte
<UploadZone
  onUpload={(files, onProgress) => Promise<UploadResult[]>}
  accept="image/*"           <!-- Accepted file types -->
  multiple={true}            <!-- Allow multiple files -->
  maxSize={10485760}         <!-- Max size in bytes (10MB) -->
/>
```

---

### AlbumModal.svelte

Album creation/editing modal.

```svelte
<AlbumModal
  albumId="123"              <!-- If present: edit mode -->
  onClose={() => {}}         <!-- Close callback -->
  onSuccess={() => {}}       <!-- Success callback -->
/>
```

---

### LazyImage.svelte

Image with lazy loading and placeholder.

```svelte
<LazyImage
  src="/api/immich/assets/123/thumbnail"
  alt="Photo description"
  aspectRatio="1"
/>
```

---

### Skeleton.svelte

Animated loading placeholder.

```svelte
<Skeleton aspectRatio="1" rounded={false}>
  <!-- Optional content (icon, etc.) -->
</Skeleton>
```

---

### MobileNav.svelte

Mobile navigation bar (fixed at bottom).

This component is automatically included in the layout and only shows on mobile (< 768px). It displays main navigation links with icons.

---

## Page Components

### PhotoModal.svelte

Full-screen modal for viewing a photo with navigation.

### ChangePhotoModal.svelte

Modal for changing a user's profile picture.

### ConfirmHost.svelte

Host for programmatic confirmation dialogs (via `showConfirm()`).

---

## Usage Patterns

### Programmatic confirmation

```typescript
import { showConfirm } from '$lib/confirm';

async function deleteItem() {
	const confirmed = await showConfirm('Do you really want to delete this item?', 'Delete');
	if (confirmed) {
		// Perform the deletion
	}
}
```

### Photo management with PhotosState

```typescript
import { PhotosState } from '$lib/photos.svelte';

// In a component
const photosState = new PhotosState();

// Load an album
await photosState.loadAlbumWithStreaming('album-id', 'Album Name', 'private');

// Selection mode
photosState.selecting = true;
photosState.toggleSelect('photo-id');
const selectedIds = Array.from(photosState.selected);
```

### Notifications

```typescript
import { toast } from '$lib/toast';

try {
	await saveData();
	toast.success('Data saved');
} catch (e) {
	toast.error('Error: ' + e.message);
}
```
