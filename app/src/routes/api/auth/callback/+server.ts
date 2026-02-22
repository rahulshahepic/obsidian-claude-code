import { redirect, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { validateState, exchangeCode, isAllowedEmail } from '$lib/server/auth/google.js';
import { createSession } from '$lib/server/auth/session.js';

/** GET — Google redirects here after the user grants (or denies) consent. */
export const GET: RequestHandler = async ({ url, cookies }) => {
	const errorParam = url.searchParams.get('error');
	if (errorParam) {
		throw redirect(302, `/login?error=${encodeURIComponent(errorParam)}`);
	}

	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');

	if (!code || !state) {
		throw error(400, 'Missing code or state parameter.');
	}

	if (!validateState(state)) {
		throw error(400, 'Invalid or expired OAuth state. Please try signing in again.');
	}

	let email: string;
	try {
		email = await exchangeCode(code);
	} catch {
		throw redirect(302, '/login?error=token_exchange_failed');
	}

	if (!isAllowedEmail(email)) {
		throw redirect(302, '/login?error=unauthorized');
	}

	createSession(cookies);
	throw redirect(302, '/');
};
