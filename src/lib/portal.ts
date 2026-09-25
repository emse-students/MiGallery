/**
 * Svelte action that moves a node under `<body>`, so no ancestor can clip it (`overflow`,
 * masks, transforms) or trap it in a lower stacking context (a `z-index` on a positioned
 * parent). Used by the overflow menu and the album page's drop overlay.
 */
export function portal(node: HTMLElement) {
  document.body.appendChild(node);
  return {
    destroy() {
      node.remove();
    },
  };
}
