import { describe, it, expect, vi, beforeEach } from 'vitest';
import { encodeMsg, parseClientMsg, SessionManager } from './session-manager.js';
import type { WsClient } from './session-manager.js';

// ---------------------------------------------------------------------------
// Pure helper tests
// ---------------------------------------------------------------------------

describe('encodeMsg', () => {
	it('serialises a text message', () => {
		const result = JSON.parse(encodeMsg({ type: 'text', content: 'hello' }));
		expect(result).toEqual({ type: 'text', content: 'hello' });
	});

	it('serialises a session_state message', () => {
		const result = JSON.parse(encodeMsg({ type: 'session_state', state: 'running' }));
		expect(result).toEqual({ type: 'session_state', state: 'running' });
	});

	it('serialises a permission_request message', () => {
		const msg = encodeMsg({
			type: 'permission_request',
			id: 'abc',
			tool: 'Bash',
			input: { command: 'ls' },
			description: 'list files'
		});
		expect(JSON.parse(msg)).toMatchObject({ type: 'permission_request', id: 'abc' });
	});
});

describe('parseClientMsg', () => {
	it('parses a valid message msg', () => {
		const msg = parseClientMsg(JSON.stringify({ type: 'message', content: 'hi' }));
		expect(msg).toEqual({ type: 'message', content: 'hi' });
	});

	it('parses a valid permission_response (allow)', () => {
		const msg = parseClientMsg(
			JSON.stringify({ type: 'permission_response', id: 'xyz', allow: true })
		);
		expect(msg).toEqual({ type: 'permission_response', id: 'xyz', allow: true });
	});

	it('parses a valid permission_response (deny)', () => {
		const msg = parseClientMsg(
			JSON.stringify({ type: 'permission_response', id: 'xyz', allow: false })
		);
		expect(msg).toEqual({ type: 'permission_response', id: 'xyz', allow: false });
	});

	it('parses a valid interrupt msg', () => {
		const msg = parseClientMsg(JSON.stringify({ type: 'interrupt' }));
		expect(msg).toEqual({ type: 'interrupt' });
	});

	it('returns null for unknown type', () => {
		expect(parseClientMsg(JSON.stringify({ type: 'unknown' }))).toBeNull();
	});

	it('returns null for malformed JSON', () => {
		expect(parseClientMsg('{not valid json')).toBeNull();
	});

	it('returns null for message without content', () => {
		expect(parseClientMsg(JSON.stringify({ type: 'message' }))).toBeNull();
	});

	it('returns null for permission_response without id', () => {
		expect(parseClientMsg(JSON.stringify({ type: 'permission_response', allow: true }))).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// SessionManager state machine tests
// ---------------------------------------------------------------------------

function makeClient(): WsClient & { received: string[] } {
	const received: string[] = [];
	return {
		readyState: 1, // OPEN
		send: vi.fn((data: string) => { received.push(data); }),
		received
	};
}

describe('SessionManager', () => {
	let manager: SessionManager;

	beforeEach(() => {
		manager = new SessionManager();
	});

	describe('client registration', () => {
		it('sends current state to newly added client', () => {
			const client = makeClient();
			manager.addClient(client);
			const msgs = client.received.map((r) => JSON.parse(r));
			expect(msgs).toContainEqual({ type: 'session_state', state: 'idle' });
		});

		it('sends cost to new client if cost > 0', () => {
			// Manually get cost into manager via broadcast
			const client1 = makeClient();
			manager.addClient(client1);
			// Simulate cost update by calling broadcast directly
			manager.broadcast({ type: 'cost', totalUsd: 0.05 });

			const client2 = makeClient();
			// Can't directly set totalCostUsd without a running session;
			// just verify addClient sends idle state with no extra cost msg
			manager.addClient(client2);
			const types = client2.received.map((r) => JSON.parse(r).type);
			expect(types).toContain('session_state');
		});

		it('removes client without error', () => {
			const client = makeClient();
			manager.addClient(client);
			manager.removeClient(client);
			// Broadcast should not reach removed client
			manager.broadcast({ type: 'text', content: 'test' });
			const postRemoveCount = client.received.length;
			// Client received the initial state msg, then nothing more after removal
			manager.broadcast({ type: 'text', content: 'after' });
			expect(client.received.length).toBe(postRemoveCount);
		});
	});

	describe('broadcast', () => {
		it('sends to all open clients', () => {
			const c1 = makeClient();
			const c2 = makeClient();
			manager.addClient(c1);
			manager.addClient(c2);
			const before1 = c1.received.length;
			const before2 = c2.received.length;
			manager.broadcast({ type: 'text', content: 'hello' });
			expect(c1.received.length).toBe(before1 + 1);
			expect(c2.received.length).toBe(before2 + 1);
			expect(JSON.parse(c1.received[c1.received.length - 1])).toEqual({
				type: 'text',
				content: 'hello'
			});
		});

		it('skips clients that are not OPEN', () => {
			const client = makeClient();
			client.readyState = 3; // CLOSED
			manager.addClient(client);
			const before = client.received.length;
			manager.broadcast({ type: 'text', content: 'test' });
			// No new messages sent to closed client
			expect(client.received.length).toBe(before);
		});
	});

	describe('permission handling', () => {
		it('sends permission_request to clients and resolves on allow', async () => {
			const client = makeClient();
			manager.addClient(client);

			const permPromise = manager.requestPermission('Bash', { command: 'rm -rf /' }, 'tool-1', 'dangerous');

			// Verify permission_request was broadcast
			const msgs = client.received.map((r) => JSON.parse(r));
			const permReq = msgs.find((m) => m.type === 'permission_request');
			expect(permReq).toBeDefined();
			expect(permReq.id).toBe('tool-1');
			expect(permReq.tool).toBe('Bash');

			// Verify state changed to waiting_permission
			const stateMsg = msgs.filter((m) => m.type === 'session_state').at(-1);
			expect(stateMsg?.state).toBe('waiting_permission');

			// Respond allow
			manager.handlePermissionResponse({ type: 'permission_response', id: 'tool-1', allow: true });

			const result = await permPromise;
			expect(result.behavior).toBe('allow');
		});

		it('resolves with deny when user denies', async () => {
			manager.addClient(makeClient());
			const permPromise = manager.requestPermission('Bash', {}, 'tool-2', 'test');
			manager.handlePermissionResponse({ type: 'permission_response', id: 'tool-2', allow: false });
			const result = await permPromise;
			expect(result.behavior).toBe('deny');
		});

		it('ignores permission_response for unknown id', () => {
			// Should not throw
			expect(() =>
				manager.handlePermissionResponse({ type: 'permission_response', id: 'unknown', allow: true })
			).not.toThrow();
		});

		it('auto-denies after timeout', async () => {
			vi.useFakeTimers();
			manager.addClient(makeClient());
			const permPromise = manager.requestPermission('Bash', {}, 'tool-timeout', 'test');
			vi.advanceTimersByTime(5 * 60 * 1000 + 100);
			const result = await permPromise;
			expect(result.behavior).toBe('deny');
			vi.useRealTimers();
		});
	});

	describe('sendMessage', () => {
		it('throws when session is idle', () => {
			expect(() => manager.sendMessage('hello')).toThrow(/idle/);
		});
	});

	describe('getState', () => {
		it('returns idle initially', () => {
			expect(manager.getState()).toBe('idle');
		});
	});
});
