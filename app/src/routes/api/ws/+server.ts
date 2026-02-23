/**
 * HTTP fallback handler for the WebSocket endpoint.
 *
 * Real WebSocket connections are handled at the HTTP server level (ws-server.ts)
 * via the Node.js 'upgrade' event and never reach this SvelteKit route.
 *
 * Stray HTTP requests — from post-login return_to redirects, bots, or health
 * checkers — get a proper 426 Upgrade Required instead of a 404.  This also
 * prevents the spurious "Not found: /api/ws" entries from appearing in the
 * error log on the /monitor page.
 */
import type { RequestHandler } from './$types';

const BODY = JSON.stringify({ error: 'Upgrade Required', detail: 'Connect via WebSocket (ws:// or wss://)' });

const handler: RequestHandler = () =>
	new Response(BODY, {
		status: 426,
		headers: {
			'Content-Type': 'application/json',
			Upgrade: 'websocket'
		}
	});

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const HEAD = handler;
export const OPTIONS = handler;
