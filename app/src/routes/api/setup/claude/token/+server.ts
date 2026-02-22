import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { setConfig, getConfig } from '$lib/server/db/index.js';
import { encrypt } from '$lib/server/crypto.js';
import { createSession } from '$lib/server/auth/session.js';

/**
 * Save a Claude OAuth token obtained via `claude setup-token`.
 * This is the Phase 1 setup path. The token is encrypted before storage.
 * Also marks setup as complete and issues a session cookie.
 */
export const POST: RequestHandler = async ({ request, cookies }) => {
	// Only callable during setup (before setup_complete = true)
	if (getConfig('setup_complete') === 'true') {
		throw error(403, 'Setup already complete. Use /settings to update credentials.');
	}

	const { token } = await request.json();
	if (!token || typeof token !== 'string' || !token.startsWith('sk-ant-')) {
		throw error(400, 'Invalid token format. Expected sk-ant-… from claude setup-token.');
	}

	setConfig('claude_oauth_token', encrypt(token.trim()));
	// Tokens from `claude setup-token` are long-lived; we don't know the exact expiry
	// so we set a conservative 7-day window and refresh proactively.
	const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
	setConfig('claude_token_expires_at', expiresAt);

	setConfig('setup_complete', 'true');
	createSession(cookies); // log in immediately after setup
	return json({ ok: true });
};
