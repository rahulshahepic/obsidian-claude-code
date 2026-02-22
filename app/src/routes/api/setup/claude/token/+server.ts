import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getConfig, setConfig } from '$lib/server/db/index.js';
import { createSession } from '$lib/server/auth/session.js';
import { storeTokens } from '$lib/server/claude/oauth.js';

/**
 * Save a Claude OAuth token obtained via `claude setup-token`.
 * This is the setup path. The token is encrypted before storage via storeTokens.
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

	// Tokens from `claude setup-token` are long-lived; use a conservative 7-day window.
	const now = new Date();
	storeTokens({
		accessToken: token.trim(),
		expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
		refreshedAt: now.toISOString()
	});

	setConfig('setup_complete', 'true');
	createSession(cookies); // log in immediately after setup
	return json({ ok: true });
};
