/**
 * Unit tests for POST /api/setup/claude/exchange
 *
 * Focuses on the code#state parsing logic introduced to handle the
 * Anthropic callback page format, plus standard request validation.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { error } from '@sveltejs/kit';

// ---- mock dependencies before importing the handler ----

vi.mock('$lib/server/claude/oauth.js', () => ({
	exchangeCode: vi.fn(),
	storeTokens: vi.fn()
}));

vi.mock('$lib/server/db/index.js', () => ({
	getConfig: vi.fn(),
	setConfig: vi.fn(),
	deleteConfig: vi.fn()
}));

import { POST } from './+server.js';
import { exchangeCode, storeTokens } from '$lib/server/claude/oauth.js';
import { getConfig, setConfig, deleteConfig } from '$lib/server/db/index.js';

// ---- helpers ----

function makeEvent(body: unknown) {
	return {
		request: new Request('http://localhost/api/setup/claude/exchange', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		})
	} as Parameters<typeof POST>[0];
}

const FAKE_TOKENS = {
	accessToken: 'at',
	refreshToken: 'rt',
	expiresAt: new Date(Date.now() + 3600_000).toISOString(),
	refreshedAt: new Date().toISOString()
};

beforeEach(() => {
	vi.clearAllMocks();
	(exchangeCode as ReturnType<typeof vi.fn>).mockResolvedValue(FAKE_TOKENS);
	(getConfig as ReturnType<typeof vi.fn>).mockReturnValue('stored-verifier');
});

// ---- tests ----

describe('POST /api/setup/claude/exchange', () => {
	describe('code#state parsing', () => {
		it('splits code and state when pasted value contains #', async () => {
			await POST(makeEvent({ code: 'auth-code-xyz#state-abc' }));

			expect(exchangeCode).toHaveBeenCalledWith('auth-code-xyz', 'stored-verifier', 'state-abc');
		});

		it('treats the whole value as code and sends null state when no # present', async () => {
			await POST(makeEvent({ code: 'plain-auth-code' }));

			expect(exchangeCode).toHaveBeenCalledWith('plain-auth-code', 'stored-verifier', null);
		});

		it('trims whitespace from the pasted value before splitting', async () => {
			await POST(makeEvent({ code: '  auth-code#state  ' }));

			// trim is applied to the whole string first, so trailing spaces after
			// the # are removed too: '  auth-code#state  '.trim() → 'auth-code#state'
			expect(exchangeCode).toHaveBeenCalledWith('auth-code', 'stored-verifier', 'state');
		});
	});

	describe('happy path', () => {
		it('stores tokens and marks setup complete', async () => {
			await POST(makeEvent({ code: 'good-code' }));

			expect(storeTokens).toHaveBeenCalledWith(FAKE_TOKENS);
			expect(setConfig).toHaveBeenCalledWith('setup_complete', 'true');
		});

		it('cleans up pending state and verifier after exchange', async () => {
			await POST(makeEvent({ code: 'good-code' }));

			expect(deleteConfig).toHaveBeenCalledWith('oauth_pending_state');
			expect(deleteConfig).toHaveBeenCalledWith('oauth_pending_verifier');
		});

		it('returns { ok: true }', async () => {
			const res = await POST(makeEvent({ code: 'good-code' }));
			const body = await res.json();
			expect(body).toEqual({ ok: true });
		});
	});

	describe('validation errors', () => {
		it('returns 400 when code is missing', async () => {
			await expect(POST(makeEvent({}))).rejects.toSatisfy(
				(e: unknown) => (e as { status?: number }).status === 400
			);
		});

		it('returns 400 when code is empty string', async () => {
			await expect(POST(makeEvent({ code: '   ' }))).rejects.toSatisfy(
				(e: unknown) => (e as { status?: number }).status === 400
			);
		});

		it('returns 400 when there is no pending OAuth session', async () => {
			(getConfig as ReturnType<typeof vi.fn>).mockReturnValue(null);

			await expect(POST(makeEvent({ code: 'some-code' }))).rejects.toSatisfy(
				(e: unknown) => (e as { status?: number }).status === 400
			);
		});

		it('returns 400 when the token exchange fails', async () => {
			(exchangeCode as ReturnType<typeof vi.fn>).mockRejectedValue(
				new Error('Token exchange failed: 400 {"type":"error"}')
			);

			await expect(POST(makeEvent({ code: 'bad-code' }))).rejects.toSatisfy(
				(e: unknown) => (e as { status?: number }).status === 400
			);
		});
	});
});
