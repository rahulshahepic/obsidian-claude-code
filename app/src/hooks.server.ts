import { redirect } from '@sveltejs/kit';
import type { Handle, HandleServerError } from '@sveltejs/kit';
import { getSession } from '$lib/server/auth/session.js';
import { getConfig } from '$lib/server/db/index.js';

/**
 * Pass the real error message through to +error.svelte.
 * This is a single-user self-hosted app — the owner seeing server errors
 * on their phone is intentional and avoids needing SSH to diagnose issues.
 */
export const handleError: HandleServerError = ({ error }) => {
	const message = error instanceof Error ? error.message : 'Internal Error';
	console.error('[server error]', error);
	return { message };
};

// No authentication required
const PUBLIC_PATHS = ['/login', '/api/health', '/api/auth/google', '/api/auth/callback'];

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
