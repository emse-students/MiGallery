import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';

const PORT = 3001;
const UPLOAD_DIR = path.join(process.cwd(), 'data', 'mock-uploads');

if (!fs.existsSync(UPLOAD_DIR)) {
	fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const server = http.createServer((req, res) => {
	console.log(`[MockImmich] ${req.method} ${req.url}`);
	console.log('[MockImmich] Headers:', req.headers);

	if (req.method === 'POST' && req.url === '/api/assets') {
		const contentType = req.headers['content-type'] || '';
		const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);

		if (!boundaryMatch) {
			console.error('[MockImmich] Missing boundary in content-type');
			res.writeHead(400);
			res.end('Missing boundary');
			return;
		}

		const boundary = boundaryMatch[1] || boundaryMatch[2];
		console.log(`[MockImmich] Boundary: ${boundary}`);

		// Simple stream to file to verify reception
		const timestamp = Date.now();
		const filePath = path.join(UPLOAD_DIR, `upload-${timestamp}.bin`);
		const writeStream = fs.createWriteStream(filePath);

		let receivedBytes = 0;
		req.on('data', (chunk) => {
			receivedBytes += chunk.length;
			writeStream.write(chunk);
		});

		req.on('end', () => {
			writeStream.end();
			console.log(`[MockImmich] Upload complete. Received ${receivedBytes} bytes.`);
			console.log(`[MockImmich] Saved to ${filePath}`);

			res.writeHead(201, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ id: `mock-asset-${timestamp}`, status: 'created' }));
		});

		req.on('error', (err) => {
			console.error('[MockImmich] Error receiving data:', err);
			res.writeHead(500);
			res.end('Internal Server Error');
		});
	} else {
		res.writeHead(404);
		res.end('Not Found');
	}
});

server.listen(PORT, () => {
	console.log(`Mock Immich server listening on http://localhost:${PORT}`);
});
