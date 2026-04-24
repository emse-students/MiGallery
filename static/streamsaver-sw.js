/* global self ReadableStream Response */

/**
 * Merged service worker:
 *  - StreamSaver.js stream-relay protocol (MessageChannel + fake-URL fetch)
 *  - Passthrough for regular GET requests (keeps the SW alive)
 *  - POST/archive requests are intentionally skipped (intercepting them causes
 *    "Error in input stream" on large streaming responses in Chrome)
 */

self.addEventListener('install', () => {
	self.skipWaiting();
});

self.addEventListener('activate', (event) => {
	event.waitUntil(self.clients.claim());
});

// ── StreamSaver protocol ──────────────────────────────────────────────────────
// Map of fake download URL → [readableStream, messageData, port]
const downloadMap = new Map();

self.addEventListener('message', (event) => {
	// Heartbeat sent by mitm.html to keep the SW alive
	if (event.data === 'ping') return;

	const data = event.data;
	if (!data || typeof data !== 'object') return;

	const port = event.ports[0];
	if (!port) return;

	const downloadUrl =
		data.url || self.registration.scope + Math.random() + '/' + (data.filename || 'download');

	const entry = new Array(3); // [stream, data, port]
	entry[1] = data;
	entry[2] = port;

	if (data.readableStream) {
		entry[0] = data.readableStream;
	} else if (data.transferringReadable) {
		port.onmessage = (evt) => {
			port.onmessage = null;
			entry[0] = evt.data.readableStream;
		};
	} else {
		entry[0] = createDownloadStream(port);
	}

	downloadMap.set(downloadUrl, entry);
	port.postMessage({ download: downloadUrl });
});

function createDownloadStream(port) {
	return new ReadableStream({
		start(controller) {
			port.onmessage = ({ data }) => {
				if (data === 'end') return controller.close();
				if (data === 'abort') {
					controller.error('Aborted the download');
					return;
				}
				controller.enqueue(data);
			};
		},
		cancel() {
			port.postMessage({ abort: true });
		}
	});
}

// ── Fetch handler ─────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
	const url = event.request.url;

	// StreamSaver: serve a hijacked download URL as a file response
	const hijacked = downloadMap.get(url);
	if (hijacked) {
		const [stream, data, port] = hijacked;
		downloadMap.delete(url);

		const responseHeaders = new Headers({
			'Content-Type': 'application/octet-stream; charset=utf-8',
			'Content-Security-Policy': "default-src 'none'",
			'X-Content-Security-Policy': "default-src 'none'",
			'X-WebKit-CSP': "default-src 'none'",
			'X-XSS-Protection': '1; mode=block'
		});

		const fwdHeaders = new Headers(data.headers || {});
		if (fwdHeaders.has('Content-Length'))
			responseHeaders.set('Content-Length', fwdHeaders.get('Content-Length'));
		if (fwdHeaders.has('Content-Disposition'))
			responseHeaders.set('Content-Disposition', fwdHeaders.get('Content-Disposition'));

		event.respondWith(new Response(stream, { headers: responseHeaders }));
		port.postMessage({ debug: 'Download started' });
		return;
	}

	// StreamSaver Firefox keep-alive ping
	if (url.endsWith('/ping')) {
		event.respondWith(new Response('pong'));
		return;
	}

	// Never intercept non-GET requests — POST archive downloads must go
	// straight to the network; relaying them through the SW causes
	// "Error in input stream" on large streaming responses.
	if (event.request.method !== 'GET') return;

	// Never intercept Immich download endpoints
	if (url.includes('/api/immich/download') || url.includes('/download/archive')) return;

	// Plain passthrough for all other GET requests (keeps the SW alive)
	event.respondWith(fetch(event.request));
});
