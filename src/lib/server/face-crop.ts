import { env } from '$env/dynamic/private';
import fs from 'node:fs';
import path from 'node:path';
import sharp from '$lib/server/sharp-config';
import { acquireSharp } from '$lib/server/sharp-limit';
import { createLogger } from '$lib/server/logger';

const log = createLogger('face-crop');
const CACHE_DIR = path.resolve('data/cache/faces');

// Square edge (px) of the generated face thumbnail. Fixed server-side so every
// consumer (picker grid, avatar, external API) gets a consistent size instead of
// relying on CSS.
export const OUTPUT_SIZE = 320;
// The face box should fill ~62% of the square, leaving some context/margin. This
// is deliberately wider than Immich's tightly hard-coded person thumbnail.
const FACE_TARGET = 0.62;
const WEBP_QUALITY = 68;

// Cache initialization
try {
	if (!fs.existsSync(CACHE_DIR)) {
		fs.mkdirSync(CACHE_DIR, { recursive: true });
	}
} catch (e) {
	log.error('Failed to create face cache directory', e);
}

interface ImmichFace {
	boundingBoxX1?: number;
	boundingBoxY1?: number;
	boundingBoxX2?: number;
	boundingBoxY2?: number;
	imageWidth?: number;
	imageHeight?: number;
	person?: { id?: string } | null;
}

type Region = { left: number; top: number; width: number; height: number };

type FetchFn = typeof fetch;

/**
 * Result of generateFaceCrop. On failure, `reason` lets the caller pick an HTTP
 * response: 'busy' -> degrade to a proxied thumbnail; 'notfound' -> 404;
 * 'config' -> 500 (missing Immich env); 'error' -> 500 (unexpected).
 */
export type FaceCropResult =
	| { ok: true; buffer: Buffer }
	| { ok: false; reason: 'busy' | 'notfound' | 'config' | 'error' };

/**
 * Generate (or read from disk cache) a square WebP cropped and centered on the
 * given person's face in an Immich asset. Immich stores no pre-cropped face
 * images: it only exposes face bounding boxes (via /api/faces) plus the full
 * image, so we crop server-side with Sharp and cache the result on disk. When no
 * matching face is found the whole image is center-cropped instead. Pass
 * "center" as personId to force a plain center crop.
 *
 * Shared by /api/faces (picker grid) and /api/users/[username]/avatar so both
 * serve the exact same crop and hit the same cache.
 */
export async function generateFaceCrop(
	assetId: string,
	personId: string,
	fetchFn: FetchFn
): Promise<FaceCropResult> {
	const apiKey = env.IMMICH_API_KEY;
	const baseUrl = env.IMMICH_BASE_URL?.replace(/\/$/, '');
	if (!apiKey || !baseUrl) {
		return { ok: false, reason: 'config' };
	}

	// One square per (asset, person): a single photo yields a different crop per
	// detected face.
	const cacheFile = path.join(CACHE_DIR, `${assetId}_${personId}.webp`);
	if (fs.existsSync(cacheFile)) {
		try {
			return { ok: true, buffer: fs.readFileSync(cacheFile) };
		} catch (e) {
			log.warn('Face cache read failed, regenerating', e);
		}
	}

	// Look up the face box BEFORE taking a Sharp slot: it is a cheap JSON call.
	let face: ImmichFace | null = null;
	if (personId && personId !== 'center') {
		try {
			const facesRes = await fetchFn(`${baseUrl}/api/faces?id=${assetId}`, {
				headers: { 'x-api-key': apiKey, accept: 'application/json' }
			});
			if (facesRes.ok) {
				const faces = (await facesRes.json()) as ImmichFace[];
				if (Array.isArray(faces)) {
					face = faces.find((f) => f.person?.id === personId) ?? null;
				}
			}
		} catch (e) {
			log.warn('face lookup failed, will center-crop', e);
		}
	}

	// Acquire the Sharp slot BEFORE downloading the source so concurrent requests
	// do not each materialize a preview buffer in native RAM (see sharp-limit).
	const release = await acquireSharp();
	if (!release) {
		return { ok: false, reason: 'busy' };
	}

	try {
		// Source = "preview" thumbnail (a few hundred KB), never the full-resolution
		// original: enough pixels for a 320px square without a large native buffer.
		const previewUrl = `${baseUrl}/api/assets/${assetId}/thumbnail?size=preview`;
		const previewRes = await fetchFn(previewUrl, { headers: { 'x-api-key': apiKey } });
		if (!previewRes.ok) {
			return { ok: false, reason: 'notfound' };
		}

		const srcBuf = Buffer.from(await previewRes.arrayBuffer());
		const image = sharp(srcBuf);
		const meta = await image.metadata();
		const sw = meta.width ?? 0;
		const sh = meta.height ?? 0;
		if (!sw || !sh) {
			return { ok: false, reason: 'error' };
		}

		const region = computeSquare(face, sw, sh);
		const processed = await image
			.extract(region)
			.resize(OUTPUT_SIZE, OUTPUT_SIZE, { fit: 'cover' })
			.webp({ quality: WEBP_QUALITY })
			.toBuffer();

		try {
			fs.writeFileSync(cacheFile, processed);
		} catch (e) {
			log.error('Face cache write failed', e);
		}

		return { ok: true, buffer: processed };
	} catch (e) {
		log.error('Error generating face crop:', e);
		return { ok: false, reason: 'error' };
	} finally {
		release();
	}
}

/**
 * Compute an integer square crop region (for sharp.extract) centered on the face
 * box, scaled from the face-detection reference frame (face.imageWidth/Height)
 * to the actual source pixels. Falls back to a centered square of the whole
 * image when no usable face box is available.
 */
function computeSquare(face: ImmichFace | null, sw: number, sh: number): Region {
	const maxSquare = Math.min(sw, sh);

	if (!face || !face.imageWidth || !face.imageHeight || !face.boundingBoxX2 || !face.boundingBoxY2) {
		const side = maxSquare;
		return {
			left: Math.round((sw - side) / 2),
			top: Math.round((sh - side) / 2),
			width: side,
			height: side
		};
	}

	const sx = sw / face.imageWidth;
	const sy = sh / face.imageHeight;
	const x1 = (face.boundingBoxX1 ?? 0) * sx;
	const y1 = (face.boundingBoxY1 ?? 0) * sy;
	const x2 = face.boundingBoxX2 * sx;
	const y2 = face.boundingBoxY2 * sy;

	const cx = (x1 + x2) / 2;
	const cy = (y1 + y2) / 2;
	const faceSize = Math.max(x2 - x1, y2 - y1);

	// Enlarge so the face fills ~FACE_TARGET of the square, then clamp so the
	// square never exceeds the image and stays fully inside it.
	let side = Math.round(Math.min(faceSize / FACE_TARGET, maxSquare));
	side = Math.max(1, side);

	let left = Math.round(cx - side / 2);
	let top = Math.round(cy - side / 2);
	left = Math.min(Math.max(0, left), sw - side);
	top = Math.min(Math.max(0, top), sh - side);

	return { left, top, width: side, height: side };
}
