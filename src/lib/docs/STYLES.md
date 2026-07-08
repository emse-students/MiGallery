# 🎨 Guide des Styles CSS - MiGallery

## Vue d'ensemble

MiGallery utilise une combinaison de **Tailwind CSS** et de **CSS personnalisé** avec un système de variables pour assurer la cohérence visuelle sur l'ensemble de l'application.

---

## 📐 Variables CSS Globales

Les variables CSS sont définies dans `src/app.css` et constituent la base du système de design.

### Couleurs

```css
:root {
	/* Arrière-plans */
	--bg-primary: #0f0f0f; /* Fond principal (noir profond) */
	--bg-secondary: #1a1a1a; /* Fond secondaire */
	--bg-tertiary: #242424; /* Fond tertiaire */
	--bg-elevated: #1f1f1f; /* Fond élevé (cartes, modales) */

	/* Texte */
	--text-primary: #ffffff; /* Texte principal (blanc) */
	--text-secondary: #a0a0a0; /* Texte secondaire (gris clair) */
	--text-muted: #6b7280; /* Texte désactivé */
	--text-tertiary: #808080; /* Texte tertiaire */

	/* Accent */
	--accent: #3b82f6; /* Bleu principal */
	--accent-hover: #2563eb; /* Bleu au hover */
	--accent-subtle: rgba(59, 130, 246, 0.1); /* Bleu subtil */

	/* Bordures */
	--border: #333333; /* Bordure principale */
	--border-color: #333333; /* Alias */
}
```

### Rayons de bordure

```css
:root {
	--radius-xs: 4px; /* Éléments petits (badges) */
	--radius-sm: 8px; /* Éléments moyens (boutons, inputs) */
	--radius-md: 12px; /* Cartes, conteneurs */
	--radius-lg: 16px; /* Grandes cartes */
	--radius-xl: 24px; /* Éléments arrondis */
}
```

### Navigation mobile

```css
:root {
	--mobile-nav-height: 72px; /* Hauteur barre mobile */
}
```

---

## 📱 Points de rupture (Breakpoints)

| Breakpoint   | Largeur max | Usage               |
| ------------ | ----------- | ------------------- |
| Mobile petit | 480px       | Téléphones compacts |
| Mobile       | 640px       | Téléphones standard |
| Tablette     | 768px       | Tablettes portrait  |
| Desktop      | 1024px      | Ordinateurs         |
| Large        | 1280px      | Grands écrans       |

### Utilisation

```css
/* Mobile first - Desktop enhancement */
.element {
	padding: 1rem; /* Mobile par défaut */
}

@media (min-width: 768px) {
	.element {
		padding: 2rem; /* Tablette et plus */
	}
}
```

---

## 🧩 Classes utilitaires

### Boutons

```css
/* Bouton principal (accent) */
.btn-primary {
	background: var(--accent);
	color: white;
	padding: 0.625rem 1rem;
	border-radius: var(--radius-sm);
}

/* Bouton secondaire */
.btn-secondary {
	background: var(--bg-elevated);
	color: var(--text-primary);
	border: 1px solid var(--border);
}

/* Bouton danger */
.btn-delete-selection {
	background: #dc2626;
	color: white;
}
```

### Cartes

```css
.card {
	background: var(--bg-tertiary);
	border: 1px solid var(--border);
	padding: 2rem;
	border-radius: var(--radius-sm);
}
```

---

## 🌈 Effets visuels

### Gradient blobs (fond statique)

Les blobs sont **figés** : pas d'animation, pas de `filter: blur`, pas de `mix-blend-mode`.
Le gradient radial suffit à adoucir le halo, et l'opacité seule remplace le blend (crashs
mémoire sur Safari mobile). Coût quasi nul, identique desktop/mobile. Voir `BackgroundBlobs.svelte`.

```css
.gradient-blob {
	position: absolute;
	border-radius: 50%;
	background: radial-gradient(circle, var(--blob-color) 0%, transparent 70%);
	opacity: 0.22; /* 0.16 en dark */
}

.blob-1 {
	background: radial-gradient(circle, rgba(14, 165, 233, 0.6) 0%, transparent 70%);
}

.blob-2 {
	background: radial-gradient(circle, rgba(139, 92, 246, 0.5) 0%, transparent 70%);
}

.blob-3 {
	background: radial-gradient(circle, rgba(236, 72, 153, 0.5) 0%, transparent 70%);
}
```

### Animation de hover

```css
.photo-card:hover {
	transform: translateY(-6px) scale(1.02);
	box-shadow: 0 20px 50px rgba(0, 0, 0, 0.7);
	border-color: rgba(255, 255, 255, 0.1);
}
```

### Backdrop blur

```css
.modal-overlay {
	background: rgba(0, 0, 0, 0.8);
	backdrop-filter: blur(4px);
}
```

---

## 📸 Grilles de photos

### Flexbox masonry

```css
.photos-grid {
	display: flex;
	flex-wrap: wrap;
	gap: 4px;
}

.photo-card {
	flex-basis: calc(220px * aspect-ratio);
	flex-grow: calc(100 * aspect-ratio);
	height: 220px;
}

/* Élément fantôme pour dernière ligne */
.photos-grid::after {
	content: '';
	flex-grow: 999999;
}
```

### Responsive grid fallback

```css
@media (max-width: 768px) {
	.photos-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
		gap: 0.75rem;
	}
}
```

---

## 🔧 Topbar

```css
.topbar {
	position: sticky;
	top: 0;
	z-index: 100;
	background: rgba(15, 15, 15, 0.8);
	backdrop-filter: blur(12px);
	border-bottom: 1px solid var(--border);
}

/* Navigation cachée sur mobile (utilise MobileNav) */
@media (max-width: 768px) {
	.topbar-links {
		display: none;
	}
}
```

---

## 📲 Navigation mobile (MobileNav)

La barre de navigation mobile (`MobileNav.svelte`) est un composant global qui apparaît en bas de l'écran sur mobile.

### Caractéristiques

- Position fixe en bas
- Icônes uniquement (pas de texte)
- Fond avec blur
- Cachée sur desktop (`display: none` au-dessus de 768px)

### Intégration dans main

```css
main {
	padding-bottom: calc(var(--mobile-nav-height) + 1rem);
}

@media (min-width: 769px) {
	main {
		padding-bottom: 2rem;
	}
}
```

---

## 🎯 Bonnes pratiques

### 1. Utiliser les variables CSS

```css
/* ✅ Bon */
.element {
	background: var(--bg-secondary);
	color: var(--text-primary);
}

/* ❌ Éviter */
.element {
	background: #1a1a1a;
	color: white;
}
```

### 2. Mobile-first

Écrire d'abord les styles mobiles, puis ajouter des media queries pour les écrans plus grands.

### 3. Utiliser les classes Tailwind

Pour les modifications rapides, utiliser Tailwind :

```svelte
<button class="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg">
  Action
</button>
```

### 4. Styles scopés dans les composants

Les styles spécifiques aux composants doivent être dans le bloc `<style>` du composant Svelte :

```svelte
<style>
  .my-component {
    /* Styles scopés automatiquement */
  }
</style>
```

---

## 🔗 Fichiers de référence

- `src/app.css` - Variables globales et styles de base
- `src/lib/components/MobileNav.svelte` - Navigation mobile
- `src/routes/+layout.svelte` - Layout principal
- `tailwind.config.cjs` - Configuration Tailwind
