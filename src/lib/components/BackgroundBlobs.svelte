<script lang="ts">
  interface BlobData {
    id: number;
    top: string;
    left: string;
    width: string;
    height: string;
    color: string;
  }

  let blobs = $state<BlobData[]>([]);

  const colors = [
    '#FF3F3F', '#FF44EC', '#AC52FF', '#5B6CFF', '#2DD4BF', '#F59E0B'
  ];

  function getRandom(min: number, max: number) {
    return Math.random() * (max - min) + min;
  }

  {
    const count = 6;
    const newBlobs: BlobData[] = [];

    for (let i = 0; i < count; i++) {
      newBlobs.push({
        id: i,
        top: `${getRandom(-20, 80)}%`,
        left: `${getRandom(-20, 80)}%`,
        width: `${getRandom(60, 90)}vw`,
        height: `${getRandom(60, 90)}vw`,
        color: colors[Math.floor(Math.random() * colors.length)],
      });
    }

    blobs = newBlobs;
  }
</script>

<div class="page-background">
  <div class="blobs-container">
    {#each blobs as blob (blob.id)}
      <div
        class="gradient-blob"
        style:top={blob.top}
        style:left={blob.left}
        style:width={blob.width}
        style:height={blob.height}
        style:background-color={blob.color}
      ></div>
    {/each}
  </div>

  <div class="noise-overlay"></div>
</div>

<style>
  .page-background {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: -1;
    /* Fond clair : blanc cassé pour moins d'agression */
    background-color: var(--bg-primary, #f8fafc);
    overflow: hidden;
    pointer-events: none;
  }

  /* --- AJUSTEMENT MODE SOMBRE --- */
  :global([data-theme='dark']) .page-background {
    /* Noir quasi absolu pour la profondeur */
    background-color: var(--bg-primary, #020408);
  }

  .blobs-container {
    position: absolute;
    inset: 0;
    /* Le flou est calculé une seule fois = pas de lag */
    filter: blur(100px);
    transform: scale(1.1); /* Zoom léger pour cacher les bords flous */
  }

  .gradient-blob {
    position: absolute;
    border-radius: 50%;
    /* Opacité standard pour le mode clair */
    opacity: 0.5;
    mix-blend-mode: multiply;
  }

  /* --- AJUSTEMENT BLOBS SOMBRES --- */
  :global([data-theme='dark']) .gradient-blob {
    /* Opacité très réduite : juste une lueur */
    opacity: 0.15;
    /* "Hard-light" ou "Screen" donne un effet néon subtil dans le noir */
    mix-blend-mode: screen;
  }

  /* Le grain reste pour la texture "premium" */
  .noise-overlay {
    position: absolute;
    inset: 0;
    opacity: 0.06;
    pointer-events: none;
    z-index: 1;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.7' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E");
  }

  :global([data-theme='dark']) .noise-overlay {
    opacity: 0.04; /* Grain encore plus discret la nuit */
  }
</style>
