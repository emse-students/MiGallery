import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { requireScope } from '$lib/server/permissions';
import { getDatabase } from '$lib/db/database';

const CACHE_DIR = path.resolve('data/cache/covers');

try {
	if (!fs.existsSync(CACHE_DIR)) {
		fs.mkdirSync(CACHE_DIR, { recursive: true });
	}
} catch (e) {
	console.error('Failed to create cache directory', e);
}

export const GET: RequestHandler = async (event) => {
	const { params, fetch } = event;
	const albumId = params.id;
	const assetId = params.assetId;

	if (!albumId || !assetId) {
		throw error(400, 'Missing albumId or assetId');
	}

	let localVisibility: string | undefined = undefined;
	try {
		const db = getDatabase();
		const row = db.prepare('SELECT visibility FROM albums WHERE id = ?').get(albumId) as
			| { visibility?: string }
			| undefined;
		localVisibility = row?.visibility;
	} catch (e) {
		console.warn('Failed to check album visibility', e);
	}

	const isUnlisted = localVisibility === 'unlisted';
	if (!isUnlisted) {
		await requireScope(event, 'read');
	}

	const cacheFile = path.join(CACHE_DIR, `${assetId}.webp`);
	if (fs.existsSync(cacheFile)) {
		try {
			const buffer = fs.readFileSync(cacheFile);
			return new Response(buffer, {
				headers: {
					'Content-Type': 'image/webp',
					'Cache-Control': 'public, max-age=604800'
				}
			});
		} catch (e) {
			console.warn('Failed to read cache file, regenerating...', e);
		}
	}

	const apiKey = env.IMMICH_API_KEY;
	const baseUrl = env.IMMICH_BASE_URL;
	if (!apiKey || !baseUrl) {
		throw error(500, 'Immich config missing');
	}

	const immichUrl = `${baseUrl}/api/assets/${assetId}/original?isWebp=true`;

	try {
		const res = await fetch(immichUrl, {
			headers: { 'x-api-key': apiKey, Accept: 'image/webp,image/*' }
		});

		if (!res.ok) {
			// Try thumbnail as a fallback when original is not available
			const thumbUrl = `${baseUrl}/api/assets/${assetId}/thumbnail?size=preview`;
			const res2 = await fetch(thumbUrl, {
				headers: { 'x-api-key': apiKey, Accept: 'image/webp,image/*' }
			});
			if (!res2.ok) {
				throw error(res.status, 'Failed to fetch image from Immich');
			}
			return processImage(await res2.arrayBuffer(), cacheFile);
		}

		// If the original exists but is not an image (e.g. a video), request the thumbnail instead
		const contentType = res.headers.get('content-type') ?? '';
		if (!contentType.startsWith('image/')) {
			const thumbUrl = `${baseUrl}/api/assets/${assetId}/thumbnail?size=preview`;
			const res2 = await fetch(thumbUrl, {
				headers: { 'x-api-key': apiKey, Accept: 'image/webp,image/*' }
			});
			if (!res2.ok) {
				throw error(res2.status, 'Failed to fetch thumbnail from Immich');
			}
			const thumbContentType = res2.headers.get('content-type') ?? '';
			if (!thumbContentType.startsWith('image/')) {
				// No usable image available from thumbnail — attempt to extract a frame via ffmpeg
				try {
					const execFileAsync = promisify(execFile);
					// Use the original response body (res) which holds the video
					const videoBuffer = Buffer.from(await res.arrayBuffer());

					const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migallery-'));
					const videoPath = path.join(tmpDir, `${assetId}-input`);
					const framePath = path.join(tmpDir, `${assetId}-frame.jpg`);
					fs.writeFileSync(videoPath, videoBuffer);

					// Get duration with ffprobe
					let duration = 0;
					try {
						const { stdout } = await execFileAsync('ffprobe', [
							'-v',
							'error',
							'-show_entries',
							'format=duration',
							'-of',
							'default=noprint_wrappers=1:nokey=1',
							videoPath
						]);
						duration = parseFloat(String(stdout)) || 0;
					} catch (ffprobeErr) {
						// If ffprobe is not available or fails, fallback to 0 (start of video)
						console.warn('ffprobe failed, falling back to start:', ffprobeErr);
						duration = 0;
					}

					const seekSeconds = duration > 0 ? Math.max(0, duration * 0.1) : 0;

					// Extract single frame at 10% using ffmpeg
					await execFileAsync('ffmpeg', [
						'-ss',
						String(seekSeconds),
						'-i',
						videoPath,
						'-frames:v',
						'1',
						'-q:v',
						'2',
						framePath
					]);

					const frameBuffer = fs.readFileSync(framePath);

					// Cleanup temp files
					try {
						fs.unlinkSync(videoPath);
						fs.unlinkSync(framePath);
						fs.rmdirSync(tmpDir);
					} catch (cleanupErr) {
						console.warn('Failed to cleanup temp files', cleanupErr);
					}

					return processImage(frameBuffer, cacheFile);
				} catch (ffErr) {
					console.error('FFmpeg/frame extraction failed:', ffErr);
					throw error(415, 'Asset is not an image and frame extraction failed');
				}
			}
			return processImage(await res2.arrayBuffer(), cacheFile);
		}

		return await processImage(await res.arrayBuffer(), cacheFile);
	} catch (e) {
		console.error('Error processing cover:', e);
		throw error(500, 'Internal Server Error processing cover');
	}
};

async function processImage(buffer: Buffer | ArrayBuffer, cacheFile: string): Promise<Response> {
	// Normalize input to a Node Buffer so both ArrayBuffer and Buffer callers work
	const inputBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

	try {
		const resizedBuffer = await sharp(inputBuffer)
			.resize(600, 600, {
				fit: 'cover',
				position: 'center'
			})
			.webp({ quality: 80 })
			.toBuffer();

		try {
			fs.writeFileSync(cacheFile, resizedBuffer);
		} catch (writeErr) {
			console.error('Failed to write to cache', writeErr);
		}

		return new Response(Buffer.from(resizedBuffer), {
			headers: {
				'Content-Type': 'image/webp',
				'Cache-Control': 'public, max-age=604800'
			}
		});
	} catch (e) {
		console.error('Sharp error:', e);
		return new Response(Buffer.from(inputBuffer), {
			headers: { 'Content-Type': 'image/jpeg' }
		});
	}
}
