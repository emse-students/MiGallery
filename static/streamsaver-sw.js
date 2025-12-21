/**
 * Minimal service worker for StreamSaver integration.
 * This is a pass-through service worker required for StreamSaver's
 * MITM (Man-In-The-Middle) approach to work.
 */

self.addEventListener('install', () => {
	// Force the waiting service worker to become the active service worker.
	self.skipWaiting();
});

self.addEventListener('activate', (event) => {
	// Ensure the service worker takes control of all clients immediately.
	event.waitUntil(self.clients.claim());
});

/**
 * Support for StreamSaver messaging.
 * The library communicates with this worker to coordinate stream relaying.
 */
self.addEventListener('message', (evt) => {
	const msg = evt.data || {};
	if (!msg || !msg.type) return;

	if (msg.type === 'ss-create') {
		// StreamSaver uses MessagePorts to bridge the stream.
		// In this minimal passthrough, we just keep the worker alive.
	}
});

/**
 * Standard fetch passthrough.
 * StreamSaver often intercepts specific URLs; this listener
 * ensures the worker remains active for those interceptions.
 */
self.addEventListener('fetch', (event) => {
	event.respondWith(fetch(event.request));
});
