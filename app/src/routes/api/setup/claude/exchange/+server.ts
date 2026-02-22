/**
 * POST /api/setup/claude/exchange
 *
 * Exchanges the OAuth authorization code (pasted from Anthropic's callback page)
 * for access + refresh tokens, then marks setup complete.
 *
 * Body: { code: string }
 *
 * The code_verifier and state were stored by GET /api/setup/claude/start.
 * After a successful exchange they are deleted from the config table.
 */
import { json, error } from '@sveltejs/kit';
import { exchangeCode, storeTokens } from '$lib/server/claude/oauth.js';
import { getConfig, setConfig, deleteConfig } from '$lib/server/db/index.js';
import { createSession } from '$lib/server/auth/session.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, cookies }) => {
	const body = await request.json().catch(() => null);
	const code = typeof body?.code === 'string' ? body.code.trim() : '';
	if (!code) throw error(400, 'code is required');

	const verifier = getConfig('oauth_pending_verifier');
	if (!verifier) throw error(400, 'No pending OAuth session — call /api/setup/claude/start first');

	let tokens;
	try {
		tokens = await exchangeCode(code, verifier);
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		throw error(400, `Token exchange failed: ${msg}`);
	}

	// Persist tokens and mark setup complete
	storeTokens(tokens);
	setConfig('setup_complete', 'true');

	// Clean up pending state
	deleteConfig('oauth_pending_state');
	deleteConfig('oauth_pending_verifier');

	// Issue a session cookie so the user is logged in immediately
	const appSecret = process.env.APP_SECRET ?? '';
	const sessionToken = createSession(appSecret);
	cookies.set('session', sessionToken, {
		path: '/',
		httpOnly: true,
		secure: process.env.NODE_ENV === 'production',
		sameSite: 'lax',
		maxAge: 60 * 60 * 24 * 30
	});

	return json({ ok: true });
};
