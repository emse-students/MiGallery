import http from 'http';
import fs from 'fs';
import path from 'path';

const UPLOAD_DIR = path.join(process.cwd(), 'data', 'chunk-uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const server = http.createServer(async (req, res) => {
	if (req.method !== 'POST' || req.url !== '/upload-chunk') {
		res.writeHead(404);
		res.end('Not found');
		return;
	}

	const filename = req.headers['x-filename'];
	const contentRange = req.headers['content-range']; // bytes start-end/total
	if (!filename || !contentRange) {
		res.writeHead(400);
		res.end('Missing x-filename or content-range headers');
		return;
	}

	const m = /bytes (\d+)-(\d+)\/(\d+)/.exec(contentRange);
	if (!m) {
		res.writeHead(400);
		res.end('Invalid Content-Range');
		return;
	}

	const start = Number(m[1]);
	const end = Number(m[2]);
	const total = Number(m[3]);

	const safeName = path.basename(String(filename));
	const tmpPath = path.join(UPLOAD_DIR, safeName + '.tmp');

	try {
		// Ensure file exists with the expected size when first chunk arrives
		if (start === 0 && !fs.existsSync(tmpPath)) {
			const fd = fs.openSync(tmpPath, 'w');
			fs.writeSync(fd, Buffer.alloc(0), 0, 0, 0);
			fs.closeSync(fd);
		}

		// Append or write at offset
		const writeStream = fs.createWriteStream(tmpPath, { flags: 'r+', start });
		let received = 0;
		req.on('data', (chunk) => {
			received += chunk.length;
		});
		req.pipe(writeStream);

		writeStream.on('finish', () => {
			const stats = fs.statSync(tmpPath);
			// If file complete, rename
			if (stats.size === total) {
				const finalPath = path.join(UPLOAD_DIR, safeName);
				fs.renameSync(tmpPath, finalPath);
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ status: 'complete', path: finalPath }));
			} else {
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ status: 'partial', received: stats.size }));
			}
		});

		writeStream.on('error', (err) => {
			console.error('Write error', err);
			res.writeHead(500);
			res.end('Write error');
		});

		req.on('error', (err) => {
			console.error('Request error', err);
		});
	} catch (err) {
		console.error('Error handling chunk', err);
		res.writeHead(500);
		res.end('Internal error');
	}
});

const PORT = process.env.CHUNK_PORT || 5000;
server.listen(PORT, () =>
	console.log(`Chunk receiver listening on http://localhost:${PORT}/upload-chunk`)
);
