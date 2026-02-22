/**
 * Attaches a WebSocket upgrade handler to a Node.js HTTP server.
 *
 * Used by:
 *   - src/server.ts  (production)
 *   - vite.config.ts configureServer plugin (development)
 *
 * Auth: validates the session cookie (or ?token= in dev) before upgrading.
 * Unauthenticated upgrade attempts receive HTTP 401.
 */
import { WebSocketServer } from 'ws';
import type { IncomingMessage, Server } from 'http';
import { parse as parseCookie } from 'cookie';
import { createHmac, timingSafeEqual } from 'crypto';
import { handleWsConnection } from './ws-handler.js';

const WS_PATH = '/api/ws';
const COOKIE_NAME = 'session';

function getSecret(): string {
	return process.env.APP_SECRET ?? '';
}

/** Returns true if the signed session token is valid. */
function isValidSession(signed: string): boolean {
	const secret = getSecret();
	if (!secret || secret.length < 32) return false;
	const dot = signed.lastIndexOf('.');
	if (dot === -1) return false;
	const token = signed.slice(0, dot);
	const mac = createHmac('sha256', secret).update(token).digest('base64url');
	const expected = `${token}.${mac}`;
	try {
		return timingSafeEqual(Buffer.from(signed), Buffer.from(expected));
	} catch {
		return false;
	}
}

/** Extract the session token from cookie header or ?token= query param. */
function extractSessionToken(req: IncomingMessage): string | null {
	const cookieHeader = req.headers['cookie'] ?? '';
	const cookies = parseCookie(cookieHeader);
	if (cookies[COOKIE_NAME]) return cookies[COOKIE_NAME];

	// Fallback to ?token= for environments where cookies aren't sent on WS
	const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
	return url.searchParams.get('token');
}

/** Attach the WebSocket server to an existing HTTP server. */
export function attachWebSocketServer(httpServer: Server): WebSocketServer {
	const wss = new WebSocketServer({ noServer: true });

	httpServer.on('upgrade', (req, socket, head) => {
		const url = req.url ?? '';
		if (!url.startsWith(WS_PATH)) {
			socket.destroy();
			return;
		}

		const token = extractSessionToken(req);
		if (!token || !isValidSession(token)) {
			socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
			socket.destroy();
			return;
		}

		wss.handleUpgrade(req, socket, head, (ws) => {
			wss.emit('connection', ws, req);
		});
	});

	wss.on('connection', (ws) => {
		// Send a protocol-level ping every 25 seconds to keep the connection alive
		// through reverse proxies and NAT that close idle WebSocket connections.
		const pingInterval = setInterval(() => {
			if (ws.readyState === ws.OPEN) ws.ping();
		}, 25_000);
		ws.once('close', () => clearInterval(pingInterval));

		handleWsConnection(
			ws,
			(event, handler) => ws.on(event as 'message', handler as (data: Buffer) => void),
			(event, handler) => ws.once(event as 'close', handler)
		);
	});

	return wss;
}
