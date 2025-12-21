import fs from 'fs';
import path from 'path';
import http from 'http';
import crypto from 'crypto';
import { parse as urlParse } from 'url';

// Configuration
const FILE_PATH =
	process.argv[2] || 'J:/Drive partagés/Photothèque/2024-2025/Clips/Film Gala 2025.mp4';
const CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB
const TARGET_URL = process.env.UPLOAD_URL || 'http://localhost:5173/api/immich/assets'; // Pointing to MiGallery Proxy
const API_KEY = process.env.API_KEY || 'test-api-key';

async function upload() {
	if (!fs.existsSync(FILE_PATH)) {
		console.error(`File not found: ${FILE_PATH}`);
		process.exit(1);
	}

	const stat = fs.statSync(FILE_PATH);
	const totalSize = stat.size;
	const filename = path.basename(FILE_PATH);
	const fileId = crypto.randomUUID();
	const totalChunks = Math.ceil(totalSize / CHUNK_SIZE);

	console.log(`Starting upload of ${filename} (${totalSize} bytes)`);
	console.log(`Total chunks: ${totalChunks}, File ID: ${fileId}`);

	const fd = fs.openSync(FILE_PATH, 'r');
	let offset = 0;
	let chunkIndex = 0;

	try {
		while (offset < totalSize) {
			const end = Math.min(offset + CHUNK_SIZE, totalSize);
			const length = end - offset;
			const buffer = Buffer.alloc(length);
			fs.readSync(fd, buffer, 0, length, offset);

			const chunkSha256 = crypto.createHash('sha256').update(buffer).digest('hex');

			console.log(`Uploading chunk ${chunkIndex + 1}/${totalChunks} (${length} bytes)...`);

			await sendChunk(buffer, {
				chunkIndex,
				totalChunks,
				fileId,
				filename,
				chunkSha256
			});

			offset = end;
			chunkIndex++;
		}
		console.log('Upload finished successfully!');
	} catch (err) {
		console.error('Upload failed:', err);
	} finally {
		fs.closeSync(fd);
	}
}

function sendChunk(buffer, meta) {
	return new Promise((resolve, reject) => {
		const urlObj = urlParse(TARGET_URL);
		const options = {
			hostname: urlObj.hostname,
			port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
			path: urlObj.path,
			method: 'POST',
			headers: {
				'Content-Type': 'application/octet-stream',
				'Content-Length': buffer.length,
				'x-chunk-index': String(meta.chunkIndex),
				'x-chunk-total': String(meta.totalChunks),
				'x-file-id': meta.fileId,
				'x-original-name': meta.filename,
				'x-chunk-sha256': meta.chunkSha256,
				'x-api-key': API_KEY
			}
		};

		const req = http.request(options, (res) => {
			let body = '';
			res.on('data', (d) => (body += d.toString()));
			res.on('end', () => {
				if (res.statusCode >= 200 && res.statusCode < 300) {
					resolve(body);
				} else {
					reject(new Error(`Server responded with ${res.statusCode}: ${body}`));
				}
			});
		});

		req.on('error', (err) => reject(err));
		req.write(buffer);
		req.end();
	});
}

upload().catch((e) => {
	console.error('Fatal error:', e);
	process.exit(1);
});
