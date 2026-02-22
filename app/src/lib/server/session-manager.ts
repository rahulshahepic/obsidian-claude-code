/**
 * Session manager — bridges the Claude Agent SDK with WebSocket clients.
 *
 * Single active session at a time (single-user app).
 * Multiple WebSocket connections can observe the same session
 * (e.g., phone + desktop both open).
 *
 * Design goals for testability:
 *   - Pure state transitions are exported as functions, not hidden in the class.
 *   - SDK and WS dependencies are injected so tests can supply mocks.
 *   - The singleton instance (sessionManager) is exported separately.
 */
import { randomUUID } from 'crypto';
import type { PermissionResult } from '@anthropic-ai/claude-agent-sdk';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { db } from './db/index.js';
import { sessions } from './db/schema.js';
import { eq } from 'drizzle-orm';
import type {
	WsServerMsg,
	WsClientMsg,
	WsPermissionResponseMsg
} from '../ws-protocol.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SessionState = 'idle' | 'running' | 'waiting_permission' | 'error' | 'done';

export interface WsClient {
	send(data: string): void;
	readyState: number;
}

export interface PendingPermission {
	resolve: (result: PermissionResult) => void;
	reject: (err: Error) => void;
	timeoutHandle: ReturnType<typeof setTimeout>;
}

// ---------------------------------------------------------------------------
// Pure state helpers (exported for unit testing)
// ---------------------------------------------------------------------------

/** Build the JSON string for a server→client message. */
export function encodeMsg(msg: WsServerMsg): string {
	return JSON.stringify(msg);
}

/** Parse and validate an inbound client message. Returns null on bad input. */
export function parseClientMsg(raw: string): WsClientMsg | null {
	try {
		const parsed = JSON.parse(raw);
		if (typeof parsed !== 'object' || parsed === null) return null;
		const t = parsed.type;
		if (t === 'message' && typeof parsed.content === 'string') return parsed as WsClientMsg;
		if (t === 'permission_response' && typeof parsed.id === 'string' && typeof parsed.allow === 'boolean')
			return parsed as WsClientMsg;
		if (t === 'interrupt') return parsed as WsClientMsg;
		return null;
	} catch {
		return null;
	}
}

// Permission timeout — 5 minutes. After that, deny automatically.
const PERMISSION_TIMEOUT_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// SessionManager class
// ---------------------------------------------------------------------------

export class SessionManager {
	private state: SessionState = 'idle';
	private clients: Set<WsClient> = new Set();
	private pendingPermissions: Map<string, PendingPermission> = new Map();
	private abortController: AbortController | null = null;
	private activeDbSessionId: string | null = null;
	private totalCostUsd = 0;

	// ---- Client registration ------------------------------------------------

	addClient(client: WsClient): void {
		this.clients.add(client);
		// Immediately sync state to the new connection
		client.send(encodeMsg({ type: 'session_state', state: this.state }));
		if (this.totalCostUsd > 0) {
			client.send(encodeMsg({ type: 'cost', totalUsd: this.totalCostUsd }));
		}
	}

	removeClient(client: WsClient): void {
		this.clients.delete(client);
	}

	getState(): SessionState {
		return this.state;
	}

	// ---- Broadcast ----------------------------------------------------------

	broadcast(msg: WsServerMsg): void {
		const data = encodeMsg(msg);
		for (const client of this.clients) {
			try {
				if (client.readyState === 1 /* OPEN */) client.send(data);
			} catch {
				// Ignore disconnected clients; they'll be removed on close event.
			}
		}
	}

	// ---- Permission handling ------------------------------------------------

	/**
	 * Called by the SDK's canUseTool callback.
	 * Suspends until the WS client responds or times out.
	 */
	async requestPermission(
		toolName: string,
		input: Record<string, unknown>,
		toolUseId: string,
		description: string
	): Promise<PermissionResult> {
		return new Promise((resolve, reject) => {
			const timeoutHandle = setTimeout(() => {
				this.pendingPermissions.delete(toolUseId);
				this.setState('running');
				resolve({ behavior: 'deny', message: 'Permission request timed out.' });
			}, PERMISSION_TIMEOUT_MS);

			this.pendingPermissions.set(toolUseId, { resolve, reject, timeoutHandle });
			this.setState('waiting_permission');
			this.broadcast({
				type: 'permission_request',
				id: toolUseId,
				tool: toolName,
				input,
				description
			});
		});
	}

	/** Called when the WS client sends a permission_response message. */
	handlePermissionResponse(msg: WsPermissionResponseMsg): void {
		const pending = this.pendingPermissions.get(msg.id);
		if (!pending) return; // Already timed out or unknown id
		clearTimeout(pending.timeoutHandle);
		this.pendingPermissions.delete(msg.id);
		this.setState('running');
		if (msg.allow) {
			pending.resolve({ behavior: 'allow' });
		} else {
			pending.resolve({ behavior: 'deny', message: 'User denied.' });
		}
	}

	// ---- Session lifecycle --------------------------------------------------

	/**
	 * Start a new Claude Code session.
	 * Returns the DB session ID (UUID).
	 */
	async startSession(
		oauthToken: string,
		vaultPath: string,
		wrapperPath: string
	): Promise<string> {
		if (this.state !== 'idle' && this.state !== 'done' && this.state !== 'error') {
			throw new Error(`Cannot start session: current state is "${this.state}".`);
		}

		const sessionId = randomUUID();
		this.activeDbSessionId = sessionId;
		this.totalCostUsd = 0;
		this.abortController = new AbortController();

		// Insert DB row
		db.insert(sessions)
			.values({ id: sessionId, startedAt: new Date(), status: 'running' })
			.run();

		this.setState('running');

		// Start the SDK query in the background — it drives the async loop.
		this._runSdkLoop(sessionId, oauthToken, vaultPath, wrapperPath).catch((err: unknown) => {
			const msg = err instanceof Error ? err.message : String(err);
			this.broadcast({ type: 'error', message: msg });
			this._finaliseSession(sessionId, 'error');
		});

		return sessionId;
	}

	/** Interrupt the active session (sends interrupt signal). */
	async interrupt(): Promise<void> {
		this.abortController?.abort();
	}

	// ---- Internal SDK loop --------------------------------------------------

	private async _runSdkLoop(
		sessionId: string,
		oauthToken: string,
		vaultPath: string,
		wrapperPath: string
	): Promise<void> {
		// Build an async queue that feeds user messages into the SDK stream.
		// The queue is resolved externally via _enqueueUserMessage.
		const self = this;
		let resolveNext: ((value: IteratorResult<{ type: 'user'; content: string; session_id: string }>) => void) | null = null;
		const messageQueue: { type: 'user'; content: string; session_id: string }[] = [];
		let closed = false;

		this._enqueueUserMessage = (content: string) => {
			const msg = { type: 'user' as const, content, session_id: sessionId };
			if (resolveNext) {
				const res = resolveNext;
				resolveNext = null;
				res({ value: msg, done: false });
			} else {
				messageQueue.push(msg);
			}
		};

		const userStream: AsyncIterable<{ type: 'user'; content: string; session_id: string }> = {
			[Symbol.asyncIterator]() {
				return {
					next(): Promise<IteratorResult<{ type: 'user'; content: string; session_id: string }>> {
						if (messageQueue.length > 0) {
							return Promise.resolve({ value: messageQueue.shift()!, done: false });
						}
						if (closed) {
							return Promise.resolve({ value: undefined as unknown as { type: 'user'; content: string; session_id: string }, done: true });
						}
						return new Promise((resolve) => {
							resolveNext = resolve;
						});
					},
					return(): Promise<IteratorResult<{ type: 'user'; content: string; session_id: string }>> {
						closed = true;
						return Promise.resolve({ value: undefined as unknown as { type: 'user'; content: string; session_id: string }, done: true });
					}
				};
			}
		};

		const sdkQuery = query({
			prompt: userStream as unknown as AsyncIterable<import('@anthropic-ai/claude-agent-sdk').SDKUserMessage>,
			options: {
				pathToClaudeCodeExecutable: wrapperPath,
				cwd: vaultPath,
				env: {
					...process.env,
					CLAUDE_CODE_OAUTH_TOKEN: oauthToken
				},
				permissionMode: 'default',
				abortController: self.abortController ?? undefined,
				canUseTool: async (toolName, input, opts) => {
					const description = opts.decisionReason ?? `${toolName} needs permission`;
					return self.requestPermission(toolName, input, opts.toolUseId, description);
				}
			}
		});

		let turnCount = 0;

		for await (const msg of sdkQuery) {
			if (msg.type === 'assistant') {
				// Extract text content from the message
				for (const block of msg.message.content) {
					if (block.type === 'text' && block.text) {
						self.broadcast({ type: 'text', content: block.text });
					} else if (block.type === 'tool_use') {
						self.broadcast({
							type: 'tool_start',
							tool: block.name,
							toolUseId: block.id,
							input: block.input as Record<string, unknown>
						});
					}
				}
				turnCount++;
			} else if (msg.type === 'tool_progress') {
				// Ignored — we get tool_end via result messages
			} else if (msg.type === 'result') {
				self.totalCostUsd = msg.total_cost_usd;
				self.broadcast({ type: 'cost', totalUsd: msg.total_cost_usd });
				// Update DB turn count
				db.update(sessions)
					.set({ turnCount })
					.where(eq(sessions.id, sessionId))
					.run();
			}
		}

		self._finaliseSession(sessionId, 'stopped');
	}

	private _enqueueUserMessage: ((content: string) => void) | null = null;

	/** Send a user message into the running session stream. */
	sendMessage(content: string): void {
		if (this.state !== 'running' && this.state !== 'waiting_permission') {
			throw new Error(`Cannot send message: session state is "${this.state}".`);
		}
		if (!this._enqueueUserMessage) {
			throw new Error('No active session stream.');
		}
		this._enqueueUserMessage(content);
	}

	// ---- Private helpers ----------------------------------------------------

	private setState(next: SessionState): void {
		this.state = next;
		this.broadcast({ type: 'session_state', state: next });
	}

	private _finaliseSession(sessionId: string, status: 'stopped' | 'error'): void {
		this._enqueueUserMessage = null;
		this.abortController = null;

		// Clear any pending permissions
		for (const [, pending] of this.pendingPermissions) {
			clearTimeout(pending.timeoutHandle);
			pending.resolve({ behavior: 'deny', message: 'Session ended.' });
		}
		this.pendingPermissions.clear();

		db.update(sessions)
			.set({ endedAt: new Date(), status })
			.where(eq(sessions.id, sessionId))
			.run();

		this.setState(status === 'error' ? 'error' : 'done');
	}
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const sessionManager = new SessionManager();
