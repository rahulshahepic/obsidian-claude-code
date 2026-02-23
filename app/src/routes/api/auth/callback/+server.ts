import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { validateState, exchangeCode, isAllowedEmail } from '$lib/server/auth/google.js';
import { createSession } from '$lib/server/auth/session.js';
import { debug } from '$lib/server/debug-logger.js';

/** GET — Google redirects here after the user grants (or denies) consent. */
export const GET: RequestHandler = async ({ url, cookies }) => {
	const errorParam = url.searchParams.get('error');
	if (errorParam) {
		debug('oauth', 'Google returned error param', { error: errorParam });
		throw redirect(302, `/login?error=${encodeURIComponent(errorParam)}`);
	}

	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');

	if (!code || !state) {
		debug('oauth', 'callback missing code or state', {
			hasCode: !!code,
			hasState: !!state
		});
		throw redirect(302, '/login?error=state_missing');
	}

	if (!validateState(state)) {
		debug('oauth', 'state validation failed — invalid or expired', {
			statePrefix: state.slice(0, 8) + '…'
		});
		throw redirect(302, '/login?error=state_invalid');
	}

	debug('oauth', 'state validated, exchanging code for token');

	let email: string;
	try {
		email = await exchangeCode(code);
	} catch (err) {
		debug('oauth', 'token exchange failed', {
			error: err instanceof Error ? err.message : String(err)
		});
		throw redirect(302, '/login?error=token_exchange_failed');
	}

	debug('oauth', 'token exchange succeeded', { email });

	if (!isAllowedEmail(email)) {
		debug('oauth', 'email not allowed', { email });
		throw redirect(302, '/login?error=unauthorized');
	}

	createSession(cookies);
	debug('oauth', 'session created, redirecting to /');
	throw redirect(302, '/');
};
