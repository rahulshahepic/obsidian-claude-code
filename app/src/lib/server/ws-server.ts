/**
 * Attaches a WebSocket upgrade handler to a Node.js HTTP server.
 *
 * Used by:
 *   - src/server.ts  (production)
 *   - vite.config.ts configureServer plugin (development)
 *
 * Auth: validates the session cookie OR a short-lived ?token= ticket issued by
 * GET /api/ws-ticket.  The ticket path supports environments (iOS Safari,
 * Android WebView, PWA) where cookies are not reliably sent with upgrades.
 * Unauthenticated upgrade attempts receive HTTP 401.
 */
import { WebSocketServer } from 'ws';
import type { IncomingMessage, Server } from 'http';
import { parse as parseCookie } from 'cookie';
import { createHmac, timingSafeEqual } from 'crypto';
import { handleWsConnection } from './ws-handler.js';
import { debug } from './debug-logger.js';
import { isValidWsTicket } from './ws-ticket.js';

const WS_PATH = '/api/ws';
const COOKIE_NAME = 'session';

function getSecret(): string {
	return process.env.APP_SECRET ?? '';
}

/** Returns true if the signed session token is valid. */
function isValidSession(signed: string): boolean {
	const secret = getSecret();
	if (!secret || secret.length < 32) {
		debug('ws-auth', 'isValidSession: APP_SECRET missing or too short', {
			secretLength: secret.length,
			hasSecret: !!secret
		});
		return false;
	}
	const dot = signed.lastIndexOf('.');
	if (dot === -1) {
		debug('ws-auth', 'isValidSession: no dot separator in token', {
			tokenLength: signed.length
		});
		return false;
	}
	const token = signed.slice(0, dot);
	const mac = createHmac('sha256', secret).update(token).digest('base64url');
	const expected = `${token}.${mac}`;
	try {
		const valid = timingSafeEqual(Buffer.from(signed), Buffer.from(expected));
		if (!valid) {
			debug('ws-auth', 'isValidSession: HMAC mismatch', {
				tokenPreview: signed.slice(0, 10) + '...',
				expectedLength: expected.length,
				actualLength: signed.length
			});
		}
		return valid;
	} catch (err) {
		debug('ws-auth', 'isValidSession: timingSafeEqual threw (length mismatch)', {
			expectedLength: expected.length,
			actualLength: signed.length,
			error: err instanceof Error ? err.message : String(err)
		});
		return false;
	}
}

/** Extract the session token from cookie header or ?token= query param. */
function extractSessionToken(req: IncomingMessage): string | null {
	const cookieHeader = req.headers['cookie'] ?? '';
	const cookies = parseCookie(cookieHeader);
	const cookieNames = Object.keys(cookies);

	debug('ws-auth', 'extractSessionToken: parsing cookies', {
		hasCookieHeader: !!cookieHeader,
		cookieHeaderLength: cookieHeader.length,
		cookieNames,
		hasSessionCookie: !!cookies[COOKIE_NAME],
		sessionCookieLength: cookies[COOKIE_NAME]?.length ?? 0
	});

	if (cookies[COOKIE_NAME]) return cookies[COOKIE_NAME];

	// Fallback to ?token= for environments where cookies aren't sent on WS
	const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
	const queryToken = url.searchParams.get('token');
	debug('ws-auth', 'extractSessionToken: no session cookie, checking query param', {
		hasQueryToken: !!queryToken
	});
	return queryToken;
}

/** Attach the WebSocket server to an existing HTTP server. */
export function attachWebSocketServer(httpServer: Server): WebSocketServer {
	const wss = new WebSocketServer({ noServer: true });

	debug('ws-server', 'WebSocket server created, attaching upgrade handler');

	httpServer.on('upgrade', (req, socket, head) => {
		const url = req.url ?? '';
		const remoteAddr = req.socket?.remoteAddress ?? 'unknown';

		debug('ws-server', 'upgrade request received', {
			url,
			remoteAddr,
			headers: {
				host: req.headers.host,
				origin: req.headers.origin,
				upgrade: req.headers.upgrade,
				connection: req.headers.connection,
				hasCookie: !!req.headers.cookie,
				'sec-websocket-version': req.headers['sec-websocket-version'],
				'sec-websocket-key': req.headers['sec-websocket-key'] ? '(present)' : '(missing)'
			}
		});

		if (!url.startsWith(WS_PATH)) {
			debug('ws-server', 'upgrade rejected: wrong path', { url, expected: WS_PATH });
			socket.destroy();
			return;
		}

		const token = extractSessionToken(req);
		if (!token) {
			debug('ws-server', 'upgrade rejected: no session token found', {
				remoteAddr,
				cookieHeader: req.headers.cookie ? `(${req.headers.cookie.length} chars)` : '(empty)'
			});
			socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
			socket.destroy();
			return;
		}

		// Accept either a long-lived session cookie token or a short-lived WS ticket.
		const valid = isValidSession(token) || isValidWsTicket(token);
		if (!valid) {
			debug('ws-server', 'upgrade rejected: invalid session token or ticket', {
				remoteAddr,
				tokenLength: token.length,
				tokenPreview: token.slice(0, 8) + '...'
			});
			socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
			socket.destroy();
			return;
		}

		debug('ws-server', 'upgrade accepted: auth valid, upgrading to WebSocket', { remoteAddr });

		wss.handleUpgrade(req, socket, head, (ws) => {
			wss.emit('connection', ws, req);
		});
	});

	wss.on('connection', (ws) => {
		debug('ws-server', 'WebSocket connection established, setting up ping interval');

		// Send a protocol-level ping every 25 seconds to keep the connection alive
		// through reverse proxies and NAT that close idle WebSocket connections.
		const pingInterval = setInterval(() => {
			if (ws.readyState === ws.OPEN) {
				ws.ping();
			}
		}, 25_000);

		ws.on('pong', () => {
			debug('ws-server', 'pong received from client');
		});

		ws.once('close', (code, reason) => {
			clearInterval(pingInterval);
			debug('ws-server', 'WebSocket closed', {
				code,
				reason: reason?.toString() ?? ''
			});
		});

		ws.on('error', (err) => {
			debug('ws-server', 'WebSocket error', {
				error: err.message,
				code: (err as NodeJS.ErrnoException).code
			});
		});

		handleWsConnection(
			ws,
			(event, handler) => ws.on(event as 'message', handler as (data: Buffer) => void),
			(event, handler) => ws.once(event as 'close', handler)
		);
	});

	return wss;
}
