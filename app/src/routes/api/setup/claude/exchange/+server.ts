/**
 * POST /api/setup/claude/exchange
 *
 * Exchanges the OAuth authorization code (pasted from Anthropic's callback page)
 * for access + refresh tokens, then marks setup complete.
 *
 * Body: { code: string }
 *
 * The code_verifier was stored by GET /api/setup/claude/start.
 * After a successful exchange it is deleted from the config table.
 *
 * Note: reaching this endpoint already requires an authenticated session
 * (enforced by hooks.server.ts). No need to create a new session here.
 */
import { json, error } from '@sveltejs/kit';
import { exchangeCode, storeTokens } from '$lib/server/claude/oauth.js';
import { getConfig, setConfig, deleteConfig } from '$lib/server/db/index.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	const code = typeof body?.code === 'string' ? body.code.trim() : '';
	if (!code) throw error(400, 'code is required');

	const verifier = getConfig('oauth_pending_verifier');
	if (!verifier) throw error(400, 'No pending OAuth session — call /api/setup/claude/start first');

	// The callback page shows "<code>#<state>" as a single string to copy.
	// Split on '#' to get the actual auth code and the embedded state.
	const hashIdx = code.indexOf('#');
	const authCode = hashIdx === -1 ? code : code.slice(0, hashIdx);
	const embeddedState = hashIdx === -1 ? null : code.slice(hashIdx + 1);

	let tokens;
	try {
		tokens = await exchangeCode(authCode, verifier, embeddedState);
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

	return json({ ok: true });
};
