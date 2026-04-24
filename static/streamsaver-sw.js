/**
 * Minimal service worker — install/activate only, no fetch interception.
 * StreamSaver has been replaced by a server-side token approach that lets
 * the browser download archives natively, so no SW relay is needed anymore.
 */

self.addEventListener('install', () => {
	self.skipWaiting();
});

self.addEventListener('activate', (event) => {
	event.waitUntil(self.clients.claim());
});
