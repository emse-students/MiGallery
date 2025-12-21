import fs from 'fs';
import path from 'path';
import http from 'http';
import { parse as urlParse } from 'url';

const FILE_PATH = path.normalize(
	'J:/Drive partagés/Photothèque/2024-2025/Clips/Film Gala 2025.mp4'
);
const CHUNK_SIZE = 8 * 1024 * 1024; // 8 MB
const URL = process.env.UPLOAD_URL || 'http://localhost:5000/upload-chunk';

async function upload() {
	const stat = fs.statSync(FILE_PATH);
	const total = stat.size;
	const filename = path.basename(FILE_PATH);
	const fd = fs.openSync(FILE_PATH, 'r');

	let offset = 0;
	let chunkIndex = 0;

	while (offset < total) {
		const end = Math.min(offset + CHUNK_SIZE, total);
		const length = end - offset;
		const buffer = Buffer.alloc(length);
		fs.readSync(fd, buffer, 0, length, offset);

		await sendChunk(buffer, filename, offset, end - 1, total);
		console.log(`Uploaded chunk ${chunkIndex} bytes ${offset}-${end - 1}`);
		offset = end;
		chunkIndex++;
	}

	fs.closeSync(fd);
	console.log('Upload finished');
}

function sendChunk(buffer, filename, start, end, total) {
	return new Promise((resolve, reject) => {
		// parse target URL
		const urlObj = urlParse(URL);
		const options = {
			hostname: urlObj.hostname,
			port: urlObj.port || 80,
			path: urlObj.path,
			method: 'POST',
			headers: {
				'Content-Type': 'application/octet-stream',
				'Content-Length': buffer.length,
				'x-filename': filename,
				'Content-Range': `bytes ${start}-${end}/${total}`
			}
		};

		const req = http.request(options, (res) => {
			let body = '';
			res.on('data', (d) => (body += d.toString()));
			res.on('end', () => {
				try {
					const parsed = JSON.parse(body || '{}');
					resolve(parsed);
				} catch (e) {
					resolve(body);
				}
			});
		});

		req.on('error', (err) => reject(err));
		req.write(buffer);
		req.end();
	});
}

upload().catch((e) => {
	console.error('Upload failed', e);
	process.exit(1);
});
