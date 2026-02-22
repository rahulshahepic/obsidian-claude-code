import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { storeTokens } from '$lib/server/claude/oauth.js';

/**
 * Update the stored Claude OAuth token from the settings page.
 * Requires the user to be authenticated (enforced by hooks.server.ts).
 * Accepts a token obtained via `claude setup-token`.
 */
export const POST: RequestHandler = async ({ request }) => {
	const { token } = await request.json();
	if (!token || typeof token !== 'string' || !token.startsWith('sk-ant-')) {
		throw error(400, 'Invalid token format. Expected sk-ant-… from claude setup-token.');
	}

	const now = new Date();
	storeTokens({
		accessToken: token.trim(),
		expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
		refreshedAt: now.toISOString()
	});

	return json({ ok: true });
};
