import { redirect } from '@sveltejs/kit';
import type { Handle, HandleServerError } from '@sveltejs/kit';
import { getSession } from '$lib/server/auth/session.js';
import { getConfig } from '$lib/server/db/index.js';
import { pushError } from '$lib/server/error-log.js';

/**
 * Pass the real error message through to +error.svelte and store it in
 * the in-memory ring buffer so it surfaces on /monitor without SSH.
 */
export const handleError: HandleServerError = ({ error }) => {
	const message = error instanceof Error ? error.message : 'Internal Error';
	const stack = error instanceof Error ? error.stack : undefined;
	console.error('[server error]', error);
	pushError(message, stack);
	return { message };
};

// No authentication required
// /vault.git is the git HTTP backend — auth is handled by GIT_HTTP_PASSWORD, not the session cookie
const PUBLIC_PATHS = [
	'/login',
	'/api/health',
	'/api/auth/google',
	'/api/auth/callback',
	'/vault.git'
];

// Authentication required, but setup_complete is not (these complete the setup)
const SETUP_PATHS = ['/setup', '/api/setup'];

export const handle: Handle = async ({ event, resolve }) => {
	const path = event.url.pathname;

	// Allow unauthenticated access to public paths
	if (PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + '/'))) {
		return resolve(event);
	}

	// All other paths require a valid session
	const isLoggedIn = getSession(event.cookies);
	if (!isLoggedIn) {
		const returnTo = encodeURIComponent(path + event.url.search);
		throw redirect(302, `/login?return_to=${returnTo}`);
	}

	// Authenticated but setup not finished — send to /setup (unless already there)
	const setupComplete = getConfig('setup_complete') === 'true';
	if (!setupComplete && !SETUP_PATHS.some((p) => path === p || path.startsWith(p + '/'))) {
		throw redirect(302, '/setup');
	}

	return resolve(event);
};
