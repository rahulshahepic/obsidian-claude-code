import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { storeTokens } from '$lib/server/claude/oauth.js';
import { setConfig } from '$lib/server/db/index.js';

/**
 * Save a Claude OAuth token obtained via `claude setup-token`.
 * This is the setup path; the token is encrypted before storage via storeTokens.
 */
export const POST: RequestHandler = async ({ request }) => {
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

	return json({ ok: true });
};
