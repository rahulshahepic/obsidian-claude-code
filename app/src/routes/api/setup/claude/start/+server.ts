/**
 * GET /api/setup/claude/start
 *
 * Initiates the browser-based Claude OAuth flow.
 * Generates PKCE params + a random state, stores them in the config table,
 * and returns the authorization URL for the client to redirect to.
 *
 * The user completes the flow at claude.ai, then Anthropic's callback page
 * (console.anthropic.com/oauth/code/callback) displays the authorization code.
 * The user pastes that code into the setup wizard, which calls
 * POST /api/setup/claude/exchange to finish the token exchange.
 */
import { json } from '@sveltejs/kit';
import { randomBytes } from 'node:crypto';
import {
	generateCodeVerifier,
	generateCodeChallenge,
	buildAuthorizationUrl
} from '$lib/server/claude/oauth.js';
import { setConfig } from '$lib/server/db/index.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	const verifier = generateCodeVerifier();
	const challenge = generateCodeChallenge(verifier);
	const state = randomBytes(16).toString('hex');

	// Store temporarily; exchange route reads and deletes them.
	setConfig('oauth_pending_state', state);
	setConfig('oauth_pending_verifier', verifier);

	const url = buildAuthorizationUrl({ codeChallenge: challenge, state });
	return json({ url });
};
