/**
 * Claude OAuth helpers.
 *
 * Pure helpers (PKCE, URL construction, expiry logic) are exported for unit testing.
 * Network-bound functions (token refresh) use the global fetch so they can be tested
 * with vi.stubGlobal('fetch', mockFn).
 */
import { createHash, randomBytes } from 'node:crypto';
import { getConfig, setConfig } from '../db/index.js';
import { encrypt, decrypt } from '../crypto.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OAuthTokens {
	accessToken: string;
	refreshToken?: string;
	expiresAt: string; // ISO datetime
	refreshedAt: string; // ISO datetime — when tokens were last stored
}

export interface TokenResponse {
	access_token: string;
	refresh_token?: string;
	expires_in?: number;
}

// ---------------------------------------------------------------------------
// PKCE helpers (pure — exported for unit testing)
// ---------------------------------------------------------------------------

/**
 * Generate a cryptographically random PKCE code_verifier.
 * RFC 7636 §4.1: 43–128 characters from the unreserved character set.
 * Using 32 bytes → 43 base64url characters (no padding).
 */
export function generateCodeVerifier(): string {
	return randomBytes(32).toString('base64url');
}

/**
 * Derive the S256 code_challenge from a code_verifier.
 * code_challenge = BASE64URL(SHA256(ASCII(code_verifier)))
 */
export function generateCodeChallenge(verifier: string): string {
	return createHash('sha256').update(verifier).digest('base64url');
}

/**
 * Construct the authorization URL for Claude's OAuth flow.
 * The redirect_uri is Anthropic-controlled (console.anthropic.com/oauth/code/callback).
 */
export function buildAuthorizationUrl(params: {
	codeChallenge: string;
	state: string;
	clientId?: string;
	redirectUri?: string;
}): string {
	const {
		codeChallenge,
		state,
		clientId = '9d1c250a-d963-4f45-acb0-9e66a5a1be0e',
		redirectUri = 'https://console.anthropic.com/oauth/code/callback'
	} = params;

	const url = new URL('https://claude.ai/oauth/authorize');
	url.searchParams.set('client_id', clientId);
	url.searchParams.set('response_type', 'code');
	url.searchParams.set('redirect_uri', redirectUri);
	url.searchParams.set('code_challenge', codeChallenge);
	url.searchParams.set('code_challenge_method', 'S256');
	url.searchParams.set('state', state);
	return url.toString();
}

// ---------------------------------------------------------------------------
// Token expiry helpers (pure — exported for unit testing)
// ---------------------------------------------------------------------------

/**
 * Returns true if the token should be refreshed.
 * A null expiresAt is treated as already expired.
 * A token expiring within `thresholdSeconds` is considered stale.
 */
export function needsRefresh(
	expiresAt: string | null,
	thresholdSeconds = 30 * 60,
	nowMs = Date.now()
): boolean {
	if (!expiresAt) return true;
	const expiresMs = new Date(expiresAt).getTime();
	return expiresMs - nowMs < thresholdSeconds * 1000;
}

// ---------------------------------------------------------------------------
// Token refresh (network I/O — injectable via vi.stubGlobal('fetch', ...) in tests)
// ---------------------------------------------------------------------------

// NOTE: The exact endpoint and response shape will be confirmed in Phase 6 via
// network inspection of `claude auth login`. This follows the standard RFC 6749
// token endpoint convention. Update TOKEN_ENDPOINT when confirmed.
const TOKEN_ENDPOINT = 'https://console.anthropic.com/v1/oauth/token';
const CLIENT_ID = '9d1c250a-d963-4f45-acb0-9e66a5a1be0e';

/**
 * Exchange an authorization code (from the OAuth callback page) for tokens.
 * Used by the browser-based setup flow.
 * Throws on non-2xx responses.
 */
export async function exchangeCode(code: string, codeVerifier: string): Promise<OAuthTokens> {
	const res = await fetch(TOKEN_ENDPOINT, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'authorization_code',
			code,
			code_verifier: codeVerifier,
			client_id: CLIENT_ID,
			redirect_uri: 'https://console.anthropic.com/oauth/code/callback'
		})
	});

	if (!res.ok) {
		const text = await res.text();
		throw new Error(`Token exchange failed: ${res.status} ${text}`);
	}

	const data = (await res.json()) as TokenResponse;
	const expiresIn = data.expires_in ?? 8 * 3600;
	const now = new Date();
	return {
		accessToken: data.access_token,
		refreshToken: data.refresh_token,
		expiresAt: new Date(now.getTime() + expiresIn * 1000).toISOString(),
		refreshedAt: now.toISOString()
	};
}

/**
 * Exchange a refresh token for new access + refresh tokens.
 * Throws on non-2xx responses.
 */
export async function refreshAccessToken(refreshToken: string): Promise<OAuthTokens> {
	const res = await fetch(TOKEN_ENDPOINT, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'refresh_token',
			refresh_token: refreshToken,
			client_id: CLIENT_ID
		})
	});

	if (!res.ok) {
		const text = await res.text();
		throw new Error(`Token refresh failed: ${res.status} ${text}`);
	}

	const data = (await res.json()) as TokenResponse;
	const expiresIn = data.expires_in ?? 8 * 3600; // default 8 hours
	const now = new Date();
	return {
		accessToken: data.access_token,
		refreshToken: data.refresh_token ?? refreshToken, // keep old if not rotated
		expiresAt: new Date(now.getTime() + expiresIn * 1000).toISOString(),
		refreshedAt: now.toISOString()
	};
}

// ---------------------------------------------------------------------------
// Config storage helpers
// ---------------------------------------------------------------------------

/**
 * Load stored OAuth tokens from the config table.
 * Returns null if no access token has been stored.
 */
export function loadTokens(): OAuthTokens | null {
	const raw = getConfig('claude_oauth_token');
	if (!raw) return null;
	const expiresAt = getConfig('claude_token_expires_at') ?? new Date(0).toISOString();
	const refreshedAt = getConfig('claude_token_refreshed_at') ?? expiresAt;
	const rawRefresh = getConfig('claude_refresh_token');
	return {
		accessToken: decrypt(raw),
		expiresAt,
		refreshedAt,
		refreshToken: rawRefresh ? decrypt(rawRefresh) : undefined
	};
}

/**
 * Persist OAuth tokens to the config table (access token and refresh token encrypted).
 */
export function storeTokens(tokens: OAuthTokens): void {
	setConfig('claude_oauth_token', encrypt(tokens.accessToken));
	setConfig('claude_token_expires_at', tokens.expiresAt);
	setConfig('claude_token_refreshed_at', tokens.refreshedAt);
	if (tokens.refreshToken) {
		setConfig('claude_refresh_token', encrypt(tokens.refreshToken));
	}
}
