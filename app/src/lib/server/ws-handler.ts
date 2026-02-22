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
import { loadTokens } from './claude/oauth.js';
import { ensureContainerRunning } from './docker.js';

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
	sessionManager.addClient(ws);

	on('message', (raw) => {
		const text = typeof raw === 'string' ? raw : raw instanceof Buffer ? raw.toString() : null;
		if (!text) return;

		const msg = parseClientMsg(text);
		if (!msg) return;

		if (msg.type === 'message') {
			// New user message — start a session if idle/done, otherwise send to active session
			const state = sessionManager.getState();
			if (state === 'idle' || state === 'done' || state === 'error') {
				// Kick off a new session, then send the first message
				_startSessionAndSend(msg.content).catch((err: unknown) => {
					const errMsg = err instanceof Error ? err.message : String(err);
					ws.send(JSON.stringify({ type: 'error', message: errMsg }));
				});
			} else {
				try {
					sessionManager.sendMessage(msg.content);
				} catch (err) {
					const errMsg = err instanceof Error ? err.message : String(err);
					ws.send(JSON.stringify({ type: 'error', message: errMsg }));
				}
			}
		} else if (msg.type === 'permission_response') {
			sessionManager.handlePermissionResponse(msg);
		} else if (msg.type === 'interrupt') {
			sessionManager.interrupt().catch(() => {/* ignore */});
		}
	});

	once('close', () => {
		sessionManager.removeClient(ws);
	});
}

async function _startSessionAndSend(firstMessage: string): Promise<void> {
	const tokens = loadTokens();
	if (!tokens?.accessToken) {
		throw new Error('No Claude token configured. Complete setup first.');
	}

	ensureContainerRunning();

	await sessionManager.startSession(tokens.accessToken, WRAPPER_PATH);
	sessionManager.sendMessage(firstMessage);
}
