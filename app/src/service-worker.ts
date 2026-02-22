/**
 * Service worker — PWA offline support.
 *
 * Strategy:
 *  - App shell (HTML, JS, CSS, fonts): cache-first with network fallback.
 *    Built assets are versioned by SvelteKit so cache busting is automatic.
 *  - Navigation requests: serve from cache if offline; show offline page otherwise.
 *  - API / WebSocket requests: network-only (never cache).
 */

/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope;

import { build, files, version } from '$service-worker';

const CACHE = `app-${version}`;

// Assets to precache: SvelteKit's built output + static files
const ASSETS = [...build, ...files];

// ---------------------------------------------------------------------------
// Install — precache app shell
// ---------------------------------------------------------------------------

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE)
			.then((cache) => cache.addAll(ASSETS))
			.then(() => self.skipWaiting())
	);
});

// ---------------------------------------------------------------------------
// Activate — delete stale caches from previous versions
// ---------------------------------------------------------------------------

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
			)
			.then(() => self.clients.claim())
	);
});

// ---------------------------------------------------------------------------
// Fetch — cache-first for assets, network-only for API calls
// ---------------------------------------------------------------------------

self.addEventListener('fetch', (event) => {
	const { request } = event;
	const url = new URL(request.url);

	// Never cache: API routes, WebSocket upgrades, or cross-origin requests
	if (
		url.origin !== self.location.origin ||
		url.pathname.startsWith('/api/') ||
		request.headers.get('upgrade') === 'websocket'
	) {
		return; // let the browser handle it normally
	}

	// For navigation requests: try network first, fall back to cached shell
	if (request.mode === 'navigate') {
		event.respondWith(
			fetch(request).catch(() =>
				caches.match('/').then((cached) => cached ?? new Response('Offline', { status: 503 }))
			)
		);
		return;
	}

	// For precached assets: cache-first
	if (ASSETS.includes(url.pathname)) {
		event.respondWith(
			caches.match(request).then((cached) => cached ?? fetch(request))
		);
		return;
	}
});
