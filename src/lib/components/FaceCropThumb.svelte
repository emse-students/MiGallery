<script lang="ts">
	import { onMount } from 'svelte';
	import Skeleton from './Skeleton.svelte';

	interface Props {
		assetId: string;
		personId: string;
		alt?: string;
	}

	interface FaceBox {
		imageWidth: number;
		imageHeight: number;
		x1: number;
		y1: number;
		x2: number;
		y2: number;
	}

	let { assetId, personId, alt = 'Face' }: Props = $props();

	// Fraction of the square the detected face box should occupy when nothing forces
	// a larger zoom. Leaves some context/margin around the face.
	const TARGET = 0.62;

	let container: HTMLDivElement | null = $state(null);
	let inView = $state(false);
	let box = $state<FaceBox | null>(null);
	let imgLoaded = $state(false);

	const thumbSrc = $derived(`/api/immich/assets/${assetId}/thumbnail?size=thumbnail`);
	// Visibility depends only on the image being loaded. The face box is a
	// progressive enhancement (it refines the crop once resolved); it must never
	// gate whether the photo is shown, otherwise a slow/failed face lookup blanks
	// the whole thumbnail.
	const ready = $derived(imgLoaded);

	// Zoom/center the thumbnail on the detected face. When no box is available for
	// this person, fall back to a plain center-cover crop of the whole thumbnail.
	const cropStyle = $derived.by(() => {
		if (!box || box.imageWidth <= 0 || box.imageHeight <= 0) {
			return 'width:100%;height:100%;left:0;top:0;object-fit:cover;';
		}
		const iw = box.imageWidth;
		const ih = box.imageHeight;
		const ar = iw / ih;
		const fw = (box.x2 - box.x1) / iw; // face width as a fraction of image width
		const fh = (box.y2 - box.y1) / ih; // face height as a fraction of image height
		const cx = (box.x1 + box.x2) / 2 / iw; // face center X (0..1 of image width)
		const cy = (box.y1 + box.y2) / 2 / ih; // face center Y (0..1 of image height)

		// The image is absolutely positioned with `height:auto`, so its rendered width
		// (in container-width units) is `k` and its rendered height is `k / ar`. Pick k
		// so the face fills TARGET of the square, but never below full coverage of the
		// square (kCover) so the crop never leaves empty gaps.
		const kCover = Math.max(1, ar);
		const kTarget = TARGET / Math.max(fw, fh / ar);
		const k = Math.max(kTarget, kCover);

		// Center the face, then clamp so the image still covers the whole square.
		const left = clamp(0.5 - cx * k, 1 - k, 0);
		const top = clamp(0.5 - cy * (k / ar), 1 - k / ar, 0);

		return `width:${(k * 100).toFixed(3)}%;height:auto;left:${(left * 100).toFixed(
			3
		)}%;top:${(top * 100).toFixed(3)}%;`;
	});

	function clamp(v: number, min: number, max: number): number {
		return Math.min(Math.max(v, min), max);
	}

	async function loadFace() {
		try {
			const res = await fetch(`/api/immich/faces?id=${assetId}`, {
				headers: { accept: 'application/json' }
			});
			if (res.ok) {
				const faces = (await res.json()) as Array<{
					imageWidth?: number;
					imageHeight?: number;
					boundingBoxX1?: number;
					boundingBoxY1?: number;
					boundingBoxX2?: number;
					boundingBoxY2?: number;
					person?: { id?: string } | null;
				}>;
				const face = Array.isArray(faces)
					? faces.find((f) => f.person?.id === personId)
					: undefined;
				if (
					face &&
					face.imageWidth &&
					face.imageHeight &&
					face.boundingBoxX2 != null &&
					face.boundingBoxY2 != null
				) {
					box = {
						imageWidth: face.imageWidth,
						imageHeight: face.imageHeight,
						x1: face.boundingBoxX1 ?? 0,
						y1: face.boundingBoxY1 ?? 0,
						x2: face.boundingBoxX2,
						y2: face.boundingBoxY2
					};
				}
			}
		} catch {
			/* fall back to center-cover crop */
		}
	}

	onMount(() => {
		if (!container) {
			return;
		}
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting) {
						inView = true;
						observer.disconnect();
						void loadFace();
					}
				}
			},
			{ rootMargin: '200px', threshold: 0.01 }
		);
		observer.observe(container);
		return () => observer.disconnect();
	});
</script>

<div bind:this={container} class="face-crop">
	{#if inView}
		<img
			src={thumbSrc}
			{alt}
			class="face-img"
			class:ready
			style={cropStyle}
			onload={() => (imgLoaded = true)}
			decoding="async"
		/>
	{/if}
	{#if !ready}
		<div class="face-skeleton">
			<Skeleton aspectRatio="1" radius="0" />
		</div>
	{/if}
</div>

<style>
	/* Fill the nearest positioned ancestor (the consumer wraps this in a
	   position:relative, aspect-ratio square). Absolute inset:0 is used instead of
	   width/height:100% because a percentage height does not resolve against a
	   parent whose height comes from aspect-ratio, which collapsed the crop to 0. */
	.face-crop {
		position: absolute;
		inset: 0;
		overflow: hidden;
		background: var(--bg-tertiary);
	}

	.face-img {
		position: absolute;
		opacity: 0;
		transition: opacity 0.3s ease;
	}

	.face-img.ready {
		opacity: 1;
	}

	.face-skeleton {
		position: absolute;
		inset: 0;
	}
</style>
