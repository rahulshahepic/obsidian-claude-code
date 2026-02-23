import { redirect } from '@sveltejs/kit';
import type { Handle, HandleServerError } from '@sveltejs/kit';
import { getSession } from '$lib/server/auth/session.js';
import { getConfig } from '$lib/server/db/index.js';
import { pushError } from '$lib/server/error-log.js';
import { debug } from '$lib/server/debug-logger.js';

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
const PUBLIC_PATHS = ['/login', '/api/health', '/api/auth/google', '/api/auth/callback', '/api/ws'];

// Authentication required, but setup_complete is not (these complete the setup)
const SETUP_PATHS = ['/setup', '/api/setup', '/api/auth/signout'];

export const handle: Handle = async ({ event, resolve }) => {
	const path = event.url.pathname;

	// Skip noisy asset requests from debug logging
	const isAsset = path.startsWith('/_app/') || path.startsWith('/favicon');

	// Allow unauthenticated access to public paths
	if (PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + '/'))) {
		if (!isAsset) debug('hooks', 'public path, no auth required', { path });
		return resolve(event);
	}

	// All other paths require a valid session
	const isLoggedIn = getSession(event.cookies);
	if (!isLoggedIn) {
		if (!isAsset) {
			debug('hooks', 'not logged in, redirecting to /login', {
				path,
				hasCookies: event.cookies.getAll().length > 0,
				cookieNames: event.cookies.getAll().map(c => c.name)
			});
		}
		const returnTo = encodeURIComponent(path + event.url.search);
		throw redirect(302, `/login?return_to=${returnTo}`);
	}

	// Authenticated but setup not finished — send to /setup (unless already there)
	const setupComplete = getConfig('setup_complete') === 'true';
	if (!setupComplete && !SETUP_PATHS.some((p) => path === p || path.startsWith(p + '/'))) {
		debug('hooks', 'setup not complete, redirecting to /setup', {
			path,
			setupComplete
		});
		throw redirect(302, '/setup');
	}

	if (!isAsset) {
		debug('hooks', 'request authorized', { path, setupComplete });
	}

	return resolve(event);
};
