/**
 * WebSocket connection handler.
 *
 * Called for each incoming WebSocket upgrade that passes auth.
 * Wires the connection into the SessionManager:
 *   - Registers the client for broadcasts
 *   - Routes inbound messages (user text, permission responses, interrupt)
 *   - Deregisters on close
 *
 * Auth is validated by the caller (ws-server) before this is called,
 * so this module has no auth logic.
 */
import type { WsClient } from './session-manager.js';
import { sessionManager, parseClientMsg } from './session-manager.js';
import { loadTokens, needsRefresh, refreshAccessToken, storeTokens } from './claude/oauth.js';
import { ensureContainerRunning } from './docker.js';
import { debug } from './debug-logger.js';
import type { WsPermissionResponseMsg } from '../ws-protocol.js';

const WRAPPER_PATH =
	process.env.CLAUDE_WRAPPER_PATH ??
	'/usr/local/bin/docker-exec-wrapper.sh';

/**
 * Handle a newly opened WebSocket connection.
 * `ws` must satisfy the WsClient interface (readyState + send).
 * `on` / `once` are passed in separately so this function is easy to unit-test.
 */
export function handleWsConnection(
	ws: WsClient,
	on: (event: string, handler: (data: unknown) => void) => void,
	once: (event: string, handler: () => void) => void
): void {
	debug('ws-handler', 'new WebSocket client connected, adding to session manager');
	sessionManager.addClient(ws);

	on('message', (raw) => {
		const text = typeof raw === 'string' ? raw : raw instanceof Buffer ? raw.toString() : null;
		if (!text) {
			debug('ws-handler', 'received non-text message, ignoring', {
				type: typeof raw,
				isBuffer: raw instanceof Buffer
			});
			return;
		}

		const msg = parseClientMsg(text);
		if (!msg) {
			debug('ws-handler', 'failed to parse client message', {
				textPreview: text.slice(0, 100)
			});
			return;
		}

		debug('ws-handler', 'received client message', { type: msg.type });

		if (msg.type === 'message') {
			// New user message — start a session if idle/done, otherwise send to active session
			const state = sessionManager.getState();
			debug('ws-handler', 'user message received', {
				currentState: state,
				contentLength: (msg as { content: string }).content.length
			});

			if (state === 'idle' || state === 'done' || state === 'error') {
				debug('ws-handler', 'starting new session for user message');
				// Kick off a new session, then send the first message
				_startSessionAndSend((msg as { content: string }).content).catch((err: unknown) => {
					const errMsg = err instanceof Error ? err.message : String(err);
					debug('ws-handler', 'session start failed', { error: errMsg });
					ws.send(JSON.stringify({ type: 'error', message: errMsg }));
				});
			} else {
				debug('ws-handler', 'forwarding message to running session');
				try {
					sessionManager.sendMessage((msg as { content: string }).content);
				} catch (err) {
					const errMsg = err instanceof Error ? err.message : String(err);
					debug('ws-handler', 'sendMessage failed', { error: errMsg });
					ws.send(JSON.stringify({ type: 'error', message: errMsg }));
				}
			}
		} else if (msg.type === 'permission_response') {
			debug('ws-handler', 'permission response received', {
				id: (msg as { id: string }).id,
				allow: (msg as { allow: boolean }).allow
			});
			sessionManager.handlePermissionResponse(msg as WsPermissionResponseMsg);
		} else if (msg.type === 'interrupt') {
			debug('ws-handler', 'interrupt received');
			sessionManager.interrupt().catch(() => {/* ignore */});
		}
	});

	once('close', () => {
		debug('ws-handler', 'WebSocket client disconnected, removing from session manager');
		sessionManager.removeClient(ws);
	});
}

async function _startSessionAndSend(firstMessage: string): Promise<void> {
	debug('ws-handler', 'loading OAuth tokens');
	let tokens = loadTokens();

	debug('ws-handler', 'token load result', {
		hasTokens: !!tokens,
		hasAccessToken: !!tokens?.accessToken,
		hasRefreshToken: !!tokens?.refreshToken,
		expiresAt: tokens?.expiresAt ?? null,
		refreshedAt: tokens?.refreshedAt ?? null,
		accessTokenLength: tokens?.accessToken?.length ?? 0,
		isExpired: tokens?.expiresAt ? new Date(tokens.expiresAt).getTime() < Date.now() : null,
		needsRefresh: tokens?.expiresAt ? needsRefresh(tokens.expiresAt) : null
	});

	if (!tokens?.accessToken) {
		throw new Error('No Claude token configured. Complete setup first.');
	}

	// Proactively refresh the access token if it is expiring within 30 minutes.
	// This is safe to do silently — if the refresh fails we proceed with the
	// existing token and let the SDK surface any auth error naturally.
	if (needsRefresh(tokens.expiresAt) && tokens.refreshToken) {
		debug('ws-handler', 'token needs refresh, attempting refresh', {
			expiresAt: tokens.expiresAt,
			msUntilExpiry: new Date(tokens.expiresAt).getTime() - Date.now()
		});
		try {
			tokens = await refreshAccessToken(tokens.refreshToken);
			storeTokens(tokens);
			debug('ws-handler', 'token refresh succeeded', {
				newExpiresAt: tokens.expiresAt
			});
		} catch (err) {
			debug('ws-handler', 'token refresh failed, proceeding with existing token', {
				error: err instanceof Error ? err.message : String(err)
			});
			// Refresh failed — proceed with the stored token. If the token is
			// genuinely expired the SDK will return an auth error.
		}
	}

	debug('ws-handler', 'ensuring container is running');
	ensureContainerRunning();

	debug('ws-handler', 'starting SDK session', {
		wrapperPath: WRAPPER_PATH,
		tokenPreview: tokens.accessToken.slice(0, 8) + '...'
	});
	await sessionManager.startSession(tokens.accessToken, WRAPPER_PATH);
	sessionManager.sendMessage(firstMessage);
	debug('ws-handler', 'session started and first message sent');
}
