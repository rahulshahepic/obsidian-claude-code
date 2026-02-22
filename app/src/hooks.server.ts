import { redirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit';
import { getSession } from '$lib/server/auth/session.js';
import { getConfig } from '$lib/server/db/index.js';

const PUBLIC_PATHS = [
	'/setup',
	'/login',
	'/api/health',
	'/api/auth/register',
	'/api/auth/login'
];

export const handle: Handle = async ({ event, resolve }) => {
	const path = event.url.pathname;

	// Allow public paths without any checks
	if (PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + '/'))) {
		return resolve(event);
	}

	// Check if setup has been completed
	const setupComplete = getConfig('setup_complete') === 'true';
	if (!setupComplete) {
		throw redirect(302, '/setup');
	}

	// Check authentication
	const isLoggedIn = getSession(event.cookies);
	if (!isLoggedIn) {
		const returnTo = encodeURIComponent(path + event.url.search);
		throw redirect(302, `/login?return_to=${returnTo}`);
	}

	return resolve(event);
};
