/**
 * Google OAuth 2.0 helper.
 *
 * Single-user model: the owner's email is specified in ALLOWED_EMAIL.
 * Any Google account matching that email is granted access.
 */
import { randomBytes } from 'crypto';
import { debug } from '$lib/server/debug-logger.js';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

// In-memory state store for CSRF protection (single-user, one pending state at a time)
const pendingStates = new Map<string, number>(); // state -> expiry timestamp
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function getClientId(): string {
	const v = process.env.GOOGLE_CLIENT_ID;
	if (!v) throw new Error('GOOGLE_CLIENT_ID env var is not set.');
	return v;
}

function getClientSecret(): string {
	const v = process.env.GOOGLE_CLIENT_SECRET;
	if (!v) throw new Error('GOOGLE_CLIENT_SECRET env var is not set.');
	return v;
}

function getRedirectUri(): string {
	const base = process.env.PUBLIC_URL ?? 'http://localhost:5173';
	return `${base}/api/auth/callback`;
}

export function generateAuthUrl(): string {
	// Clean up expired states
	const now = Date.now();
	let expired = 0;
	for (const [s, exp] of pendingStates) {
		if (exp < now) {
			pendingStates.delete(s);
			expired++;
		}
	}

	const state = randomBytes(16).toString('base64url');
	pendingStates.set(state, now + STATE_TTL_MS);

	debug('oauth', 'generated auth URL', {
		statePrefix: state.slice(0, 8) + '…',
		pendingCount: pendingStates.size,
		expiredCleaned: expired,
		redirectUri: getRedirectUri()
	});

	const params = new URLSearchParams({
		client_id: getClientId(),
		redirect_uri: getRedirectUri(),
		response_type: 'code',
		scope: 'openid email',
		state,
		access_type: 'online',
		prompt: 'select_account'
	});

	return `${GOOGLE_AUTH_URL}?${params}`;
}

export function validateState(state: string): boolean {
	const exp = pendingStates.get(state);
	const now = Date.now();

	if (!exp) {
		debug('oauth', 'state not found in pendingStates', {
			statePrefix: state.slice(0, 8) + '…',
			pendingCount: pendingStates.size,
			pendingPrefixes: [...pendingStates.keys()].map((k) => k.slice(0, 8) + '…')
		});
		return false;
	}

	if (exp < now) {
		debug('oauth', 'state expired', {
			statePrefix: state.slice(0, 8) + '…',
			expiredAgoMs: now - exp
		});
		pendingStates.delete(state);
		return false;
	}

	pendingStates.delete(state);
	debug('oauth', 'state validated and consumed', {
		statePrefix: state.slice(0, 8) + '…',
		remainingMs: exp - now
	});
	return true;
}

/** Exchange an authorization code for the user's verified email address. */
export async function exchangeCode(code: string): Promise<string> {
	const res = await fetch(GOOGLE_TOKEN_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			code,
			client_id: getClientId(),
			client_secret: getClientSecret(),
			redirect_uri: getRedirectUri(),
			grant_type: 'authorization_code'
		})
	});

	if (!res.ok) {
		const body = await res.text();
		throw new Error(`Google token exchange failed (${res.status}): ${body}`);
	}

	const data = await res.json();

	// Decode the id_token JWT payload — no signature check needed since we
	// received this directly from Google over HTTPS.
	const payload = JSON.parse(
		Buffer.from((data.id_token as string).split('.')[1], 'base64url').toString()
	);

	if (!payload.email) throw new Error('Google id_token has no email field.');
	return payload.email as string;
}

export function isAllowedEmail(email: string): boolean {
	const allowed = process.env.ALLOWED_EMAIL;
	if (!allowed) throw new Error('ALLOWED_EMAIL env var is not set.');
	return email.toLowerCase() === allowed.toLowerCase();
}
