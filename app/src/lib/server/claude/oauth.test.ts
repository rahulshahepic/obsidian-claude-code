/**
 * Tests for claude/oauth.ts
 *
 * Pure functions (PKCE, URL construction, expiry logic) and refreshAccessToken
 * are tested directly. storeTokens/loadTokens are tested through a mocked db
 * module + real crypto to verify encryption and key routing without spinning
 * up a real SQLite database.
 */
import { vi, describe, it, expect, afterEach, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Hoist DB mock functions so they're available in the vi.mock factory
// ---------------------------------------------------------------------------
const mockGetConfig = vi.hoisted(() => vi.fn<[string], string | null>(() => null));
const mockSetConfig = vi.hoisted(() => vi.fn<[string, string], void>());

vi.mock('../db/index.js', () => ({
	getConfig: mockGetConfig,
	setConfig: mockSetConfig,
	deleteConfig: vi.fn()
}));

import {
	generateCodeVerifier,
	generateCodeChallenge,
	buildAuthorizationUrl,
	needsRefresh,
	exchangeCode,
	refreshAccessToken,
	storeTokens,
	loadTokens
} from './oauth.js';
import { encrypt, decrypt } from '../crypto.js';

// ---------------------------------------------------------------------------
// generateCodeVerifier
// ---------------------------------------------------------------------------

describe('generateCodeVerifier', () => {
	it('returns a 43-character base64url string', () => {
		// 32 bytes base64url-encoded = 43 characters (no padding)
		expect(generateCodeVerifier()).toHaveLength(43);
	});

	it('only contains URL-safe characters', () => {
		expect(generateCodeVerifier()).toMatch(/^[A-Za-z0-9\-_]+$/);
	});

	it('returns a different value on each call', () => {
		expect(generateCodeVerifier()).not.toBe(generateCodeVerifier());
	});
});

// ---------------------------------------------------------------------------
// generateCodeChallenge
// ---------------------------------------------------------------------------

describe('generateCodeChallenge', () => {
	it('produces the correct S256 challenge', () => {
		const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
		const expected = createHash('sha256').update(verifier).digest('base64url');
		expect(generateCodeChallenge(verifier)).toBe(expected);
	});

	it('is deterministic for the same input', () => {
		const v = generateCodeVerifier();
		expect(generateCodeChallenge(v)).toBe(generateCodeChallenge(v));
	});

	it('only contains URL-safe characters', () => {
		expect(generateCodeChallenge(generateCodeVerifier())).toMatch(/^[A-Za-z0-9\-_]+$/);
	});

	it('produces different challenges for different verifiers', () => {
		expect(generateCodeChallenge('aaa')).not.toBe(generateCodeChallenge('bbb'));
	});
});

// ---------------------------------------------------------------------------
// buildAuthorizationUrl
// ---------------------------------------------------------------------------

describe('buildAuthorizationUrl', () => {
	it('targets https://claude.ai/oauth/authorize', () => {
		const url = new URL(buildAuthorizationUrl({ codeChallenge: 'ch', state: 'st' }));
		expect(url.origin).toBe('https://claude.ai');
		expect(url.pathname).toBe('/oauth/authorize');
	});

	it('includes all required PKCE parameters', () => {
		const url = new URL(buildAuthorizationUrl({ codeChallenge: 'ch', state: 'st' }));
		expect(url.searchParams.get('code_challenge')).toBe('ch');
		expect(url.searchParams.get('code_challenge_method')).toBe('S256');
		expect(url.searchParams.get('response_type')).toBe('code');
		expect(url.searchParams.get('state')).toBe('st');
	});

	it('uses the default Claude Code client_id', () => {
		const url = new URL(buildAuthorizationUrl({ codeChallenge: 'c', state: 's' }));
		expect(url.searchParams.get('client_id')).toBe('9d1c250a-e61b-44d9-88ed-5944d1962f5e');
	});

	it('uses the Anthropic-controlled default redirect_uri', () => {
		const url = new URL(buildAuthorizationUrl({ codeChallenge: 'c', state: 's' }));
		expect(url.searchParams.get('redirect_uri')).toBe(
			'https://console.anthropic.com/oauth/code/callback'
		);
	});

	it('accepts clientId and redirectUri overrides', () => {
		const url = new URL(
			buildAuthorizationUrl({
				codeChallenge: 'c',
				state: 's',
				clientId: 'custom-id',
				redirectUri: 'https://example.com/cb'
			})
		);
		expect(url.searchParams.get('client_id')).toBe('custom-id');
		expect(url.searchParams.get('redirect_uri')).toBe('https://example.com/cb');
	});

	it('includes the default Claude Code scope', () => {
		const url = new URL(buildAuthorizationUrl({ codeChallenge: 'c', state: 's' }));
		const scope = url.searchParams.get('scope') ?? '';
		expect(scope).toContain('user:profile');
		expect(scope).toContain('user:inference');
		expect(scope).toContain('user:sessions:claude_code');
	});

	it('accepts a custom scope override', () => {
		const url = new URL(
			buildAuthorizationUrl({ codeChallenge: 'c', state: 's', scope: 'openid email' })
		);
		expect(url.searchParams.get('scope')).toBe('openid email');
	});
});

// ---------------------------------------------------------------------------
// needsRefresh
// ---------------------------------------------------------------------------

describe('needsRefresh', () => {
	const now = new Date('2026-02-22T12:00:00Z').getTime();

	it('returns true when expiresAt is null', () => {
		expect(needsRefresh(null, 1800, now)).toBe(true);
	});

	it('returns true when token is already past expiry', () => {
		const past = new Date(now - 1000).toISOString();
		expect(needsRefresh(past, 1800, now)).toBe(true);
	});

	it('returns true when expiry is within the threshold window', () => {
		// expires in 10 min, threshold 30 min → stale
		const soonExpiry = new Date(now + 10 * 60 * 1000).toISOString();
		expect(needsRefresh(soonExpiry, 30 * 60, now)).toBe(true);
	});

	it('returns false when token is comfortably valid', () => {
		// expires in 2 hours, threshold 30 min → valid
		const future = new Date(now + 2 * 3600 * 1000).toISOString();
		expect(needsRefresh(future, 30 * 60, now)).toBe(false);
	});

	it('respects a custom threshold', () => {
		const in5min = new Date(now + 5 * 60 * 1000).toISOString();
		expect(needsRefresh(in5min, 60, now)).toBe(false); // threshold 1 min → valid
		expect(needsRefresh(in5min, 10 * 60, now)).toBe(true); // threshold 10 min → stale
	});
});

// ---------------------------------------------------------------------------
// refreshAccessToken — mocked fetch
// ---------------------------------------------------------------------------

describe('refreshAccessToken', () => {
	afterEach(() => vi.restoreAllMocks());

	it('returns new tokens on a 200 response', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({
					access_token: 'new-access-token',
					refresh_token: 'new-refresh-token',
					expires_in: 28800
				})
			})
		);

		const tokens = await refreshAccessToken('old-refresh-token');
		expect(tokens.accessToken).toBe('new-access-token');
		expect(tokens.refreshToken).toBe('new-refresh-token');
		// expiresAt should be ~8h from now
		const expiresMs = new Date(tokens.expiresAt).getTime();
		expect(expiresMs).toBeGreaterThan(Date.now() + 7 * 3600 * 1000);
	});

	it('falls back to the original refresh token when the server omits one', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({ access_token: 'tok', expires_in: 3600 })
			})
		);

		const tokens = await refreshAccessToken('my-refresh-token');
		expect(tokens.refreshToken).toBe('my-refresh-token');
	});

	it('defaults to an 8-hour expiry when expires_in is omitted', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({ access_token: 'tok' })
			})
		);

		const before = Date.now();
		const tokens = await refreshAccessToken('r');
		const expiresMs = new Date(tokens.expiresAt).getTime();
		expect(expiresMs).toBeGreaterThanOrEqual(before + 8 * 3600 * 1000);
	});

	it('throws on a non-OK HTTP response', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: false,
				status: 401,
				text: async () => 'Unauthorized'
			})
		);

		await expect(refreshAccessToken('bad-token')).rejects.toThrow('401');
	});

	it('sends grant_type=refresh_token and the token in the request body', async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ access_token: 'tok', expires_in: 3600 })
		});
		vi.stubGlobal('fetch', mockFetch);

		await refreshAccessToken('my-token');
		const [, init] = mockFetch.mock.calls[0];
		const body = JSON.parse(init.body as string);
		expect(body.grant_type).toBe('refresh_token');
		expect(body.refresh_token).toBe('my-token');
	});
});

// ---------------------------------------------------------------------------
// exchangeCode — mocked fetch
// ---------------------------------------------------------------------------

describe('exchangeCode', () => {
	afterEach(() => vi.restoreAllMocks());

	it('returns tokens on a 200 response', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({
					access_token: 'access-tok',
					refresh_token: 'refresh-tok',
					expires_in: 3600
				})
			})
		);

		const tokens = await exchangeCode('auth-code-123', 'verifier-abc');
		expect(tokens.accessToken).toBe('access-tok');
		expect(tokens.refreshToken).toBe('refresh-tok');
		expect(new Date(tokens.expiresAt).getTime()).toBeGreaterThan(Date.now() + 3000 * 1000);
	});

	it('sends grant_type=authorization_code with code, verifier, and state', async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ access_token: 'tok', expires_in: 3600 })
		});
		vi.stubGlobal('fetch', mockFetch);

		await exchangeCode('the-code', 'the-verifier', 'the-state');
		const [, init] = mockFetch.mock.calls[0];
		const body = JSON.parse(init.body as string);
		expect(body.grant_type).toBe('authorization_code');
		expect(body.code).toBe('the-code');
		expect(body.code_verifier).toBe('the-verifier');
		expect(body.state).toBe('the-state');
		expect(body.redirect_uri).toBe('https://console.anthropic.com/oauth/code/callback');
	});

	it('defaults to 8-hour expiry when expires_in is omitted', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({ access_token: 'tok' })
			})
		);

		const before = Date.now();
		const tokens = await exchangeCode('c', 'v');
		expect(new Date(tokens.expiresAt).getTime()).toBeGreaterThanOrEqual(
			before + 8 * 3600 * 1000
		);
	});

	it('throws on a non-OK response', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: false,
				status: 400,
				text: async () => 'invalid_grant'
			})
		);

		await expect(exchangeCode('bad-code', 'v')).rejects.toThrow('400');
	});
});

// ---------------------------------------------------------------------------
// storeTokens — mocked DB + real crypto
// ---------------------------------------------------------------------------

describe('storeTokens', () => {
	beforeEach(() => vi.clearAllMocks());

	it('encrypts and stores the access token under claude_oauth_token', () => {
		storeTokens({
			accessToken: 'sk-ant-oat01-test',
			expiresAt: '2026-03-01T00:00:00Z',
			refreshedAt: '2026-02-22T12:00:00Z'
		});

		const call = mockSetConfig.mock.calls.find(([key]) => key === 'claude_oauth_token');
		expect(call).toBeDefined();
		expect(decrypt(call![1])).toBe('sk-ant-oat01-test');
	});

	it('stores expiresAt and refreshedAt as plain strings', () => {
		storeTokens({
			accessToken: 'tok',
			expiresAt: '2026-03-01T00:00:00Z',
			refreshedAt: '2026-02-22T12:00:00Z'
		});

		const expCall = mockSetConfig.mock.calls.find(([k]) => k === 'claude_token_expires_at');
		const refCall = mockSetConfig.mock.calls.find(([k]) => k === 'claude_token_refreshed_at');
		expect(expCall![1]).toBe('2026-03-01T00:00:00Z');
		expect(refCall![1]).toBe('2026-02-22T12:00:00Z');
	});

	it('encrypts and stores the refresh token when provided', () => {
		storeTokens({
			accessToken: 'access',
			refreshToken: 'refresh-secret',
			expiresAt: '2026-03-01T00:00:00Z',
			refreshedAt: '2026-02-22T12:00:00Z'
		});

		const call = mockSetConfig.mock.calls.find(([k]) => k === 'claude_refresh_token');
		expect(call).toBeDefined();
		expect(decrypt(call![1])).toBe('refresh-secret');
	});

	it('does not store claude_refresh_token when refreshToken is absent', () => {
		storeTokens({
			accessToken: 'tok',
			expiresAt: '2026-03-01T00:00:00Z',
			refreshedAt: '2026-02-22T12:00:00Z'
		});

		const call = mockSetConfig.mock.calls.find(([k]) => k === 'claude_refresh_token');
		expect(call).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// loadTokens — mocked DB + real crypto
// ---------------------------------------------------------------------------

describe('loadTokens', () => {
	beforeEach(() => vi.clearAllMocks());

	it('returns null when no access token is stored', () => {
		mockGetConfig.mockReturnValue(null);
		expect(loadTokens()).toBeNull();
	});

	it('decrypts and returns stored tokens', () => {
		const accessToken = 'sk-ant-oat01-loaded';
		const encrypted = encrypt(accessToken);

		mockGetConfig.mockImplementation((key: string) => {
			if (key === 'claude_oauth_token') return encrypted;
			if (key === 'claude_token_expires_at') return '2026-03-01T00:00:00Z';
			if (key === 'claude_token_refreshed_at') return '2026-02-22T12:00:00Z';
			return null;
		});

		const loaded = loadTokens();
		expect(loaded).not.toBeNull();
		expect(loaded!.accessToken).toBe(accessToken);
		expect(loaded!.expiresAt).toBe('2026-03-01T00:00:00Z');
		expect(loaded!.refreshedAt).toBe('2026-02-22T12:00:00Z');
	});

	it('decrypts and returns the refresh token when present', () => {
		const refreshToken = 'my-refresh-secret';
		mockGetConfig.mockImplementation((key: string) => {
			if (key === 'claude_oauth_token') return encrypt('access');
			if (key === 'claude_token_expires_at') return '2026-03-01T00:00:00Z';
			if (key === 'claude_token_refreshed_at') return '2026-02-22T12:00:00Z';
			if (key === 'claude_refresh_token') return encrypt(refreshToken);
			return null;
		});

		const loaded = loadTokens();
		expect(loaded!.refreshToken).toBe(refreshToken);
	});

	it('returns undefined refreshToken when none is stored', () => {
		mockGetConfig.mockImplementation((key: string) => {
			if (key === 'claude_oauth_token') return encrypt('access');
			if (key === 'claude_token_expires_at') return '2026-03-01T00:00:00Z';
			if (key === 'claude_token_refreshed_at') return '2026-02-22T12:00:00Z';
			return null;
		});

		const loaded = loadTokens();
		expect(loaded!.refreshToken).toBeUndefined();
	});

	it('falls back to expiresAt for refreshedAt when not stored', () => {
		mockGetConfig.mockImplementation((key: string) => {
			if (key === 'claude_oauth_token') return encrypt('access');
			if (key === 'claude_token_expires_at') return '2026-03-01T00:00:00Z';
			return null; // claude_token_refreshed_at not stored
		});

		const loaded = loadTokens();
		expect(loaded!.refreshedAt).toBe('2026-03-01T00:00:00Z');
	});
});
