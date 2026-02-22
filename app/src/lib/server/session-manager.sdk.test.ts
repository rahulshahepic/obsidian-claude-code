/**
 * Mock-based tests for SessionManager._runSdkLoop.
 * Mocks the Claude Agent SDK and the DB so no real subprocess is spawned.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ------- hoisted mocks -------------------------------------------------------
const mockQuery = vi.hoisted(() => vi.fn());
const mockDbInsert = vi.hoisted(() => vi.fn(() => ({ values: vi.fn(() => ({ run: vi.fn() })) })));
const mockDbUpdate = vi.hoisted(() =>
	vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => ({ run: vi.fn() })) })) }))
);

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: mockQuery }));
vi.mock('./db/index.js', () => ({
	db: { insert: mockDbInsert, update: mockDbUpdate },
	getConfig: vi.fn(() => null)
}));

import { SessionManager } from './session-manager.js';
import type { WsClient } from './session-manager.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClient(): WsClient & { received: string[] } {
	const received: string[] = [];
	return { readyState: 1, send: vi.fn((d: string) => received.push(d)), received };
}

/**
 * Build a mock async generator that yields the provided SDK messages then ends.
 */
async function* makeQueryGen(
	messages: unknown[]
): AsyncGenerator<unknown, void, unknown> {
	for (const msg of messages) {
		yield msg;
	}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SessionManager._runSdkLoop (SDK mocked)', () => {
	let manager: SessionManager;

	beforeEach(() => {
		manager = new SessionManager();
		mockQuery.mockReset();
		mockDbInsert.mockReturnValue({ values: vi.fn(() => ({ run: vi.fn() })) });
		mockDbUpdate.mockReturnValue({
			set: vi.fn(() => ({ where: vi.fn(() => ({ run: vi.fn() })) }))
		});
	});

	it('broadcasts text content from assistant messages', async () => {
		const client = makeClient();
		manager.addClient(client);

		mockQuery.mockReturnValueOnce(
			makeQueryGen([
				{
					type: 'assistant',
					message: {
						content: [{ type: 'text', text: 'Hello from Claude!' }]
					}
				},
				{
					type: 'result',
					total_cost_usd: 0.001,
					num_turns: 1
				}
			])
		);

		await manager.startSession('token', '/wrapper.sh');

		// Give the async loop time to process
		await new Promise((r) => setTimeout(r, 50));

		const textMsgs = client.received
			.map((r) => JSON.parse(r))
			.filter((m) => m.type === 'text');
		expect(textMsgs).toContainEqual({ type: 'text', content: 'Hello from Claude!' });
	});

	it('broadcasts tool_start for tool_use blocks', async () => {
		const client = makeClient();
		manager.addClient(client);

		mockQuery.mockReturnValueOnce(
			makeQueryGen([
				{
					type: 'assistant',
					message: {
						content: [
							{
								type: 'tool_use',
								id: 'tool-abc',
								name: 'Bash',
								input: { command: 'ls' }
							}
						]
					}
				},
				{ type: 'result', total_cost_usd: 0, num_turns: 1 }
			])
		);

		await manager.startSession('token', '/wrapper.sh');
		await new Promise((r) => setTimeout(r, 50));

		const toolMsgs = client.received
			.map((r) => JSON.parse(r))
			.filter((m) => m.type === 'tool_start');
		expect(toolMsgs).toContainEqual(
			expect.objectContaining({ type: 'tool_start', tool: 'Bash', toolUseId: 'tool-abc' })
		);
	});

	it('broadcasts cost from result messages', async () => {
		const client = makeClient();
		manager.addClient(client);

		mockQuery.mockReturnValueOnce(
			makeQueryGen([{ type: 'result', total_cost_usd: 0.042, num_turns: 2 }])
		);

		await manager.startSession('token', '/wrapper.sh');
		await new Promise((r) => setTimeout(r, 50));

		const costMsgs = client.received
			.map((r) => JSON.parse(r))
			.filter((m) => m.type === 'cost');
		expect(costMsgs).toContainEqual({ type: 'cost', totalUsd: 0.042 });
	});

	it('transitions to done state after loop completes', async () => {
		const client = makeClient();
		manager.addClient(client);

		mockQuery.mockReturnValueOnce(
			makeQueryGen([{ type: 'result', total_cost_usd: 0, num_turns: 1 }])
		);

		await manager.startSession('token', '/wrapper.sh');
		await new Promise((r) => setTimeout(r, 50));

		const stateMsgs = client.received
			.map((r) => JSON.parse(r))
			.filter((m) => m.type === 'session_state')
			.map((m) => m.state);
		expect(stateMsgs).toContain('done');
	});

	it('transitions to error state on SDK exception', async () => {
		const client = makeClient();
		manager.addClient(client);

		// Mock query to throw
		async function* throwingGen(): AsyncGenerator<never, void, unknown> {
			throw new Error('SDK exploded');
			// eslint-disable-next-line no-unreachable
			yield;
		}
		mockQuery.mockReturnValueOnce(throwingGen());

		await manager.startSession('token', '/wrapper.sh');
		await new Promise((r) => setTimeout(r, 50));

		const stateMsgs = client.received
			.map((r) => JSON.parse(r))
			.filter((m) => m.type === 'session_state')
			.map((m) => m.state);
		expect(stateMsgs).toContain('error');
	});

	it('allows sendMessage after startSession', async () => {
		mockQuery.mockReturnValueOnce(
			makeQueryGen([{ type: 'result', total_cost_usd: 0, num_turns: 1 }])
		);

		await manager.startSession('token', '/wrapper.sh');
		// Session is running — sendMessage should work
		expect(() => manager.sendMessage('follow-up')).not.toThrow();
	});

	it('calls query() with oauth token, wrapper path, and canUseTool callback', async () => {
		mockQuery.mockReturnValueOnce(makeQueryGen([]));

		await manager.startSession('my-token', '/my-wrapper.sh');
		// Yield so _runSdkLoop starts and calls query()
		await new Promise((r) => setTimeout(r, 50));

		expect(mockQuery).toHaveBeenCalledOnce();
		const opts = mockQuery.mock.calls[0][0].options;
		expect(opts.env.CLAUDE_CODE_OAUTH_TOKEN).toBe('my-token');
		expect(opts.pathToClaudeCodeExecutable).toBe('/my-wrapper.sh');
		expect(typeof opts.canUseTool).toBe('function');
	});

	it('cannot start a second session while one is running', async () => {
		// Use a hanging generator so the first session stays 'running'
		let closeGen: () => void;
		async function* hangingGen(): AsyncGenerator<unknown, void, unknown> {
			await new Promise<void>((r) => { closeGen = r; });
		}
		mockQuery.mockReturnValueOnce(hangingGen());

		await manager.startSession('token', '/wrapper.sh');
		// Yield so _runSdkLoop starts and state = 'running'
		await new Promise((r) => setTimeout(r, 20));

		await expect(manager.startSession('token', '/wrapper.sh')).rejects.toThrow(
			/running/
		);

		closeGen!();
	});
});
