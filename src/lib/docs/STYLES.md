# 🎨 CSS Styles Guide - MiGallery

## Overview

MiGallery uses a combination of **Tailwind CSS** and **custom CSS** with a variable system to ensure visual consistency across the entire application.

---

## 📐 Global CSS Variables

CSS variables are defined in `src/app.css` and form the foundation of the design system.

### Colors

```css
:root {
  /* Backgrounds */
  --bg-primary: #0f0f0f; /* Main background (deep black) */
  --bg-secondary: #1a1a1a; /* Secondary background */
  --bg-tertiary: #242424; /* Tertiary background */
  --bg-elevated: #1f1f1f; /* Elevated background (cards, modals) */

  /* Text */
  --text-primary: #ffffff; /* Primary text (white) */
  --text-secondary: #a0a0a0; /* Secondary text (light gray) */
  --text-muted: #6b7280; /* Disabled text */
  --text-tertiary: #808080; /* Tertiary text */

  /* Accent */
  --accent: #3b82f6; /* Primary blue */
  --accent-hover: #2563eb; /* Blue on hover */
  --accent-subtle: rgba(59, 130, 246, 0.1); /* Subtle blue */

  /* Borders */
  --border: #333333; /* Main border */
  --border-color: #333333; /* Alias */
}
```

### Border radii

```css
:root {
  --radius-xs: 4px; /* Small elements (badges) */
  --radius-sm: 8px; /* Medium elements (buttons, inputs) */
  --radius-md: 12px; /* Cards, containers */
  --radius-lg: 16px; /* Large cards */
  --radius-xl: 24px; /* Rounded elements */
}
```

### Mobile navigation

```css
:root {
  --mobile-nav-height: 72px; /* Mobile bar height */
}
```

---

## 📱 Breakpoints

| Breakpoint   | Max width | Usage            |
| ------------ | --------- | ---------------- |
| Small mobile | 480px     | Compact phones   |
| Mobile       | 640px     | Standard phones  |
| Tablet       | 768px     | Portrait tablets |
| Desktop      | 1024px    | Computers        |
| Large        | 1280px    | Large screens    |

### Usage

```css
/* Mobile first - Desktop enhancement */
.element {
  padding: 1rem; /* Mobile default */
}

@media (min-width: 768px) {
  .element {
    padding: 2rem; /* Tablet and up */
  }
}
```

---

## 🧩 Utility classes

### Buttons

ONE button class, `.btn`, defined in `src/app.css` - a flat tonal fill whose hover is a state layer
(8% of the text colour), no blur, no coloured shadow, no lift. Modifiers: `.primary` and `.success`
are coloured by default; `.danger`, `.info`, `.edit` and `.warning` stay neutral and colour only on
hover; `.icon` is square and compact; `.active` is the "on" state of a toggle.

```svelte
<button class="btn primary">...</button>
<button class="btn danger icon" aria-label="...">...</button>
```

### Surfaces

`.surface` is a tonal panel (`--surface` fill, `--surface-border` edge, `--radius`), translucent so
the background blobs still show, never blurred and never shadowed.

---

## 🌈 Visual effects

### Gradient blobs (static background)

Blobs are **frozen**: no animation, no `filter: blur`, no `mix-blend-mode`.
The radial gradient alone is enough to soften the halo, and opacity alone replaces blend (memory
crashes on Safari mobile). Near-zero cost, identical desktop/mobile. See `BackgroundBlobs.svelte`.

```css
.gradient-blob {
  position: absolute;
  border-radius: 50%;
  background: radial-gradient(circle, var(--blob-color) 0%, transparent 70%);
  opacity: 0.22; /* 0.16 in dark */
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

### Flat surfaces - no glass, no glow, no lift

Components are FLAT (`docs/wiki/ui-redesign.md` #25, measured against Google Photos, which carries
no blur, no coloured shadow and no text-shadow): no `backdrop-filter`, no coloured or wide
`box-shadow` on anything lying in the page flow, no `text-shadow`, no gradient fill or gradient text,
no `translateY`/`scale` on hover. Elevation is a tonal step (`--bg-secondary` -> `--bg-tertiary` ->
`--bg-elevated`); only what really floats (a dialog, a menu) keeps the neutral `--shadow-lg`. A panel
floating over content is OPAQUE, since without a blur a translucent one shows the content through its
text. The one exception is the page background: the blobs above stay, they are the app's identity.

```css
.modal-overlay {
  background: rgba(0, 0, 0, 0.8);
}
```

---

## 📸 Photo grids

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

/* Ghost element for last row */
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
  border-bottom: 1px solid var(--border);
}

/* Navigation hidden on mobile (uses MobileNav) */
@media (max-width: 768px) {
  .topbar-links {
    display: none;
  }
}
```

---

## 📲 Mobile navigation (MobileNav)

The mobile navigation bar (`MobileNav.svelte`) is a global component that appears at the bottom of the screen on mobile.

### Characteristics

- Fixed position at the bottom
- Icons only (no text)
- Opaque background
- Hidden on desktop (`display: none` above 768px)

### Integration in main

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

## 🎯 Best practices

### 1. Use CSS variables

```css
/* ✅ Good */
.element {
  background: var(--bg-secondary);
  color: var(--text-primary);
}

/* ❌ Avoid */
.element {
  background: #1a1a1a;
  color: white;
}
```

### 2. Mobile-first

Write mobile styles first, then add media queries for larger screens.

### 3. Use Tailwind classes

For quick modifications, use Tailwind:

```svelte
<button class="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg"> Action </button>
```

### 4. Scoped styles in components

Component-specific styles should be in the Svelte component's `<style>` block:

```svelte
<style>
  .my-component {
    /* Automatically scoped styles */
  }
</style>
```

---

## 🔗 Reference files

- `src/app.css` - Global variables and base styles
- `src/lib/components/MobileNav.svelte` - Mobile navigation
- `src/routes/+layout.svelte` - Main layout
- `vite.config.ts` - Tailwind (Vite plugin) and the Lightning CSS vendor-prefix targets

There is no `tailwind.config.cjs` and no `postcss.config.cjs`. Tailwind 4 is configured
in CSS (`@import 'tailwindcss'` plus `@theme`), discovers its own source files, and runs
as a Vite plugin; the JS config that used to sit here was never loaded, because nothing
declared `@config`.
