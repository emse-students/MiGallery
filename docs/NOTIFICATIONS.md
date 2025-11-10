# Système de notifications et modals - MiGallery

## Vue d'ensemble

Ce document décrit le nouveau système de notifications et de modals mis en place pour améliorer l'UX et maintenir un design cohérent.

## Composants principaux

### 1. Toast (Notifications légères)

Les toasts sont des notifications non-intrusives qui apparaissent en haut à droite de l'écran.

**Fichiers:**
- `src/lib/toast.ts` - Store Svelte pour gérer les toasts
- `src/lib/components/Toast.svelte` - Composant toast individuel
- `src/lib/components/ToastContainer.svelte` - Conteneur global (dans layout)

**Usage:**
```typescript
import { toast } from '$lib/toast';

// Messages simples
toast.success('Photo uploadée !');
toast.error('Erreur lors du téléchargement');
toast.warning('Attention : fichier volumineux');
toast.info('Chargement en cours...');

// Personnaliser la durée (en ms)
toast.success('Message', 5000);
```

**Quand utiliser:**
- Confirmations d'actions (upload réussi, suppression effectuée)
- Erreurs non-critiques
- Messages informatifs courts
- Feedback immédiat sans bloquer l'utilisateur

### 2. Modal (Dialogues)

Les modals sont des dialogues modaux qui bloquent l'interaction avec la page principale.

**Fichiers:**
- `src/lib/components/Modal.svelte` - Composant modal réutilisable

**Usage:**
```svelte
<script>
  import Modal from '$lib/components/Modal.svelte';
  
  let showModal = $state(false);
  
  async function handleConfirm() {
    // Action à effectuer
    await deletePhoto();
  }
</script>

<Modal
  bind:show={showModal}
  title="Supprimer la photo"
  type="confirm"
  confirmText="Supprimer"
  cancelText="Annuler"
  onConfirm={handleConfirm}
>
  {#snippet children()}
    <p>Voulez-vous vraiment supprimer cette photo ?</p>
  {/snippet}
</Modal>
```

**Types disponibles:**
- `info` - Information (icône bleue)
- `success` - Succès (icône verte)
- `error` - Erreur (icône rouge)
- `warning` - Avertissement (icône jaune)
- `confirm` - Confirmation avec 2 boutons

**Props:**
- `show` - Afficher/masquer (bindable)
- `title` - Titre du modal
- `type` - Type (info|success|error|warning|confirm)
- `icon` - Icône personnalisée (optionnel)
- `confirmText` - Texte du bouton de confirmation
- `cancelText` - Texte du bouton d'annulation
- `onConfirm` - Callback de confirmation (async supporté)
- `onCancel` - Callback d'annulation
- `wide` - Modal plus large (pour formulaires)

**Quand utiliser:**
- Confirmations d'actions destructives (suppression, etc.)
- Formulaires
- Messages importants nécessitant l'attention de l'utilisateur
- Affichage de contenu complexe

### 3. Système de tracking des opérations

Bloque les navigations/fermetures pendant les uploads et autres opérations longues.

**Fichiers:**
- `src/lib/operations.ts` - Store pour tracker les opérations actives

**Usage:**
```typescript
import { activeOperations } from '$lib/operations';

async function handleUpload(files: File[]) {
  const operationId = `upload-${Date.now()}`;
  activeOperations.start(operationId);
  
  try {
    // Faire l'upload
    await uploadFiles(files);
    toast.success('Upload terminé !');
  } catch (error) {
    toast.error('Erreur: ' + error.message);
  } finally {
    activeOperations.end(operationId);
  }
}
```

**Fonctionnalités:**
- Affiche un avertissement natif du navigateur si l'utilisateur essaie de fermer l'onglet
- Affiche un modal si l'utilisateur essaie de naviguer vers une autre page
- Empêche la perte de données lors d'opérations en cours

## Migration depuis alert() et confirm()

### Avant (alert)
```typescript
alert('Photo uploadée !');
alert('Erreur lors du téléchargement');
```

### Après (toast)
```typescript
import { toast } from '$lib/toast';

toast.success('Photo uploadée !');
toast.error('Erreur lors du téléchargement');
```

### Avant (confirm)
```typescript
if (!confirm('Supprimer cette photo ?')) return;
await deletePhoto();
```

### Après (modal)
```svelte
<script>
  let showDeleteModal = $state(false);
  
  async function confirmDelete() {
    await deletePhoto();
    toast.success('Photo supprimée !');
  }
</script>

<button onclick={() => showDeleteModal = true}>Supprimer</button>

<Modal
  bind:show={showDeleteModal}
  title="Supprimer la photo"
  type="confirm"
  onConfirm={confirmDelete}
>
  {#snippet children()}
    <p>Voulez-vous vraiment supprimer cette photo ?</p>
  {/snippet}
</Modal>
```

## Exemples d'implémentation

### Pages déjà migrées
- ✅ `src/routes/photos-cv/+page.svelte` - Upload avec progression
- ✅ `src/lib/components/PhotosGrid.svelte` - Suppression avec modal
- ✅ `src/routes/mes-photos/+page.svelte` - Toast pour changement photo

### Pages à migrer
- ⏳ `src/routes/parametres/+page.svelte` - ~15 alerts/confirms
- ⏳ `src/routes/albums/+page.svelte` - ~5 alerts/confirms
- ⏳ `src/routes/albums/[id]/+page.svelte` - ~10 alerts/confirms
- ⏳ `src/routes/corbeille/+page.svelte` - ~4 alerts
- ⏳ `src/routes/trombinoscope/+page.svelte` - ~8 alerts/confirms

## Bonnes pratiques

### Choix toast vs modal

**Toast:**
- Actions non-destructives
- Confirmations rapides
- Erreurs récupérables
- Messages d'information

**Modal:**
- Actions destructives (suppression, etc.)
- Collecte de données (formulaires)
- Messages critiques
- Décisions importantes

### Gestion des erreurs

```typescript
try {
  await riskyOperation();
  toast.success('Opération réussie !');
} catch (error) {
  console.error('Erreur détaillée:', error);
  toast.error('Erreur: ' + (error as Error).message);
}
```

### Upload avec progression

```typescript
async function handleUpload(files: File[], onProgress?: (current: number, total: number) => void) {
  const operationId = `upload-${Date.now()}`;
  activeOperations.start(operationId);
  
  try {
    for (let i = 0; i < files.length; i++) {
      onProgress?.(i, files.length);
      await uploadFile(files[i]);
    }
    onProgress?.(files.length, files.length);
    toast.success(`${files.length} fichier(s) uploadé(s) !`);
  } catch (error) {
    toast.error('Erreur: ' + (error as Error).message);
  } finally {
    activeOperations.end(operationId);
  }
}
```

## Architecture

```
src/
├── lib/
│   ├── toast.ts                    # Store toast
│   ├── operations.ts               # Store opérations actives
│   ├── ui-helpers.svelte.ts        # Helpers (pour migration future)
│   └── components/
│       ├── Modal.svelte            # Composant modal
│       ├── Toast.svelte            # Composant toast
│       └── ToastContainer.svelte   # Conteneur toasts
└── routes/
    └── +layout.svelte              # Inclut ToastContainer + Modal navigation
```

## Accessibilité

- Modals utilisent `<dialog>` natif HTML5
- Support clavier (Escape pour fermer)
- ARIA labels appropriés
- Focus trap dans les modals
- Toasts avec timeout automatique

## Performance

- Toasts limités à 500 entrées max dans le cache
- Cleanup automatique des toasts fermés
- Modals utilise Svelte 5 runes pour réactivité optimale
- Pas de re-renders inutiles

## TODO

- [ ] Migrer toutes les pages vers le nouveau système
- [ ] Ajouter animations de transition pour les toasts
- [ ] Support RTL (right-to-left) pour les toasts
- [ ] Thème sombre pour modals et toasts
- [ ] Tests unitaires pour composants

## Support

Pour toute question ou problème, consulter :
- Documentation Svelte 5: https://svelte.dev/docs/svelte/v5-migration-guide
- Code existant dans `photos-cv` et `PhotosGrid`
