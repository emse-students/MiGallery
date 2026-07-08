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
        style="--blob-color: {blob.color};"
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
    /* Light theme: off-white, softer than pure white */
    background-color: var(--bg-primary, #f8fafc);
    overflow: hidden;
    pointer-events: none;
  }

  /* --- DARK THEME --- */
  :global([data-theme='dark']) .page-background {
    /* Near-absolute black for depth */
    background-color: var(--bg-primary, #020408);
  }

  .blobs-container {
    position: absolute;
    inset: 0;
    /* No blur filter here - it was removed to save GPU memory */
  }

  /*
   * Static color halos. No mix-blend-mode and no filter: blur - both create
   * GPU composite layers that are heavy and crash mobile Safari at this size.
   * The radial-gradient already fades to transparent, so plain opacity gives
   * the same soft look for near-zero cost, and works identically on mobile.
   */
  .gradient-blob {
    position: absolute;
    border-radius: 50%;
    background: radial-gradient(circle, var(--blob-color) 0%, transparent 70%);
    opacity: 0.22;
  }

  :global([data-theme='dark']) .gradient-blob {
    /* Faint glow against the near-black background */
    opacity: 0.16;
  }

  /* Trim opacity a touch on small / touch screens for battery; blobs stay on. */
  @media (max-width: 768px), (hover: none) {
    .gradient-blob {
      opacity: 0.16;
    }
    :global([data-theme='dark']) .gradient-blob {
      opacity: 0.12;
    }
  }

  /*
   * Static grain texture. A single small SVG raster tiled via background-size
   * keeps memory tiny; no blend mode, so it stays cheap on every device.
   */
  .noise-overlay {
    position: absolute;
    inset: 0;
    opacity: 0.06;
    pointer-events: none;
    z-index: 1;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.7' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E");
    background-size: 180px 180px;
  }

  :global([data-theme='dark']) .noise-overlay {
    opacity: 0.04; /* Even more discreet at night */
  }
</style>
