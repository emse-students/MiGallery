import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import NodeFormData from 'form-data';
import { URL } from 'url';

// Mock environment
const IMMICH_BASE_URL = 'http://localhost:3001';
const IMMICH_API_KEY = 'test-api-key';

// Mock helpers
function ensureError(err) {
	return err instanceof Error ? err : new Error(String(err));
}

async function logEvent(event, action, type, id, details) {
	console.log(`[LogEvent] ${action} ${type} ${id}`, details);
}

// Copied and adapted from +server.ts
async function handleChunkedUpload(req, res, outgoingHeaders, baseUrl) {
	const chunkIndex = parseInt(req.headers['x-chunk-index'] || '0');
	const totalChunks = parseInt(req.headers['x-chunk-total'] || '1');
	const fileId = req.headers['x-file-id'];

	if (!fileId) {
		res.writeHead(400, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ error: 'Missing x-file-id header for chunked upload' }));
		return;
	}

	const tempFilePath = path.join(os.tmpdir(), `immich_proxy_${fileId}.part`);
	const lockPath = `${tempFilePath}.lock`;
	const completePath = `${tempFilePath}.complete`;

	try {
		// obtain a quick advisory lock per fileId to avoid concurrent writers
		try {
			const fd = fs.openSync(lockPath, 'wx');
			fs.closeSync(fd);
		} catch {
			res.writeHead(409, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: 'File currently locked, retry' }));
			return;
		}

		const buffer = await new Promise((resolve, reject) => {
			const chunks = [];
			req.on('data', (chunk) => chunks.push(chunk));
			req.on('end', () => resolve(Buffer.concat(chunks)));
			req.on('error', reject);
		});

		// verify per-chunk sha256
		try {
			const chunkSha = req.headers['x-chunk-sha256'];
			if (chunkSha) {
				const computed = crypto.createHash('sha256').update(buffer).digest('hex');
				if (computed !== chunkSha) {
					try {
						if (fs.existsSync(lockPath)) {
							fs.unlinkSync(lockPath);
						}
					} catch {
						/* ignore */
					}
					res.writeHead(400, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ error: 'Chunk hash mismatch' }));
					return;
				}
			}
		} catch {
			/* ignore verification errors */
		}

		try {
			if (chunkIndex === 0) {
				fs.writeFileSync(tempFilePath, buffer);
			} else {
				fs.appendFileSync(tempFilePath, buffer);
			}
		} finally {
			try {
				if (fs.existsSync(lockPath)) {
					fs.unlinkSync(lockPath);
				}
			} catch {
				/* ignore */
			}
		}

		if (chunkIndex < totalChunks - 1) {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ status: 'chunk_received', index: chunkIndex }));
			return;
		}

		console.debug(`[Immich-Proxy] Réassemblage terminé pour ${fileId}, envoi à Immich...`);

		const originalName = req.headers['x-original-name'] || `upload-${fileId}.bin`;

		// compute checksum (sha256)
		const hash = crypto.createHash('sha256');
		await new Promise((resolve, reject) => {
			const rs = fs.createReadStream(tempFilePath);
			rs.on('data', (chunk) => hash.update(chunk));
			rs.on('end', () => resolve());
			rs.on('error', (err) => reject(err));
		});
		const sha256 = hash.digest('hex');

		try {
			fs.renameSync(tempFilePath, completePath);
		} catch (e) {
			console.warn('Failed to rename temp file to complete:', e);
		}

		const formData = new NodeFormData();
		formData.append('assetData', fs.createReadStream(completePath), { filename: originalName });

		const immichUrl = `${baseUrl}/api/assets`;
		const fetchHeaders = { ...outgoingHeaders };

		const formHeaders = formData.getHeaders();
		for (const k of Object.keys(formHeaders)) {
			fetchHeaders[k] = formHeaders[k];
		}

		// Calculate content length to prevent "Unexpected end of form" errors with large files
		/*
        try {
            const length = await new Promise((resolve, reject) => {
                formData.getLength((err, length) => {
                    if (err) reject(err);
                    else resolve(length);
                });
            });
            if (length) {
                fetchHeaders['content-length'] = String(length);
            }
        } catch (e) {
            console.warn('Failed to calculate form data length:', e);
        }
        */

		fetchHeaders['x-proxy-sha256'] = sha256;

		console.log(`[Proxy] Sending to Immich: ${immichUrl}`);
		console.log(`[Proxy] Headers:`, fetchHeaders);

		const response = await fetch(immichUrl, {
			method: 'POST',
			headers: fetchHeaders,
			body: formData,
			duplex: 'half'
		});

		if (response.ok) {
			try {
				const respClone = response.clone();
				const respData = await respClone.json();
				const assetId = respData.id;
				if (assetId) {
					await logEvent(req, 'create', 'asset', assetId, { originalName, proxied: true });
				}
			} catch (e) {
				console.warn('Failed to log upload:', e);
			}
		} else {
			console.error(`[Proxy] Immich responded with ${response.status} ${response.statusText}`);
			const txt = await response.text();
			console.error(`[Proxy] Response body: ${txt}`);
		}

		try {
			if (fs.existsSync(completePath)) {
				fs.unlinkSync(completePath);
			}
			if (fs.existsSync(tempFilePath)) {
				fs.unlinkSync(tempFilePath);
			}
		} catch (e) {
			console.warn('Failed to cleanup temp file', e);
		}

		const forwardedHeaders = {};
		const safeRespForward = ['content-type', 'etag', 'cache-control', 'expires', 'x-immich-cid'];
		for (const h of safeRespForward) {
			const v = response.headers.get(h);
			if (v !== null && v !== undefined) {
				forwardedHeaders[h] = v;
			}
		}

		res.writeHead(response.status, forwardedHeaders);
		const arrayBuffer = await response.arrayBuffer();
		res.end(Buffer.from(arrayBuffer));
	} catch (err) {
		const _err = ensureError(err);
		console.error('[Immich-Proxy] Error processing chunk:', _err);
		try {
			if (fs.existsSync(tempFilePath)) {
				fs.unlinkSync(tempFilePath);
			}
		} catch {
			/* ignore */
		}

		res.writeHead(500, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ error: _err.message || 'Internal Server Error processing chunk' }));
	}
}

const server = http.createServer(async (req, res) => {
	// Enable CORS
	res.setHeader('Access-Control-Allow-Origin', '*');
	res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
	res.setHeader('Access-Control-Allow-Headers', '*');

	if (req.method === 'OPTIONS') {
		res.writeHead(200);
		res.end();
		return;
	}

	if (req.method === 'POST' && req.url.includes('/api/immich/assets')) {
		const chunkHeaders = {
			accept: req.headers['accept'] || '*/*'
		};
		if (IMMICH_API_KEY) {
			chunkHeaders['x-api-key'] = IMMICH_API_KEY;
		}
		await handleChunkedUpload(req, res, chunkHeaders, IMMICH_BASE_URL);
	} else {
		res.writeHead(404);
		res.end('Not Found');
	}
});

const PORT = 5173;
server.listen(PORT, () => {
	console.log(`Test Proxy Server listening on http://localhost:${PORT}`);
});
