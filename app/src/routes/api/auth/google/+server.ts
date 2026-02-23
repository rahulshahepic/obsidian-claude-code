import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { generateAuthUrl } from '$lib/server/auth/google.js';

/** GET — redirect the browser to Google's OAuth consent screen. */
export const GET: RequestHandler = async ({ cookies }) => {
	const { url, state } = generateAuthUrl();

	// Store the state in an HttpOnly cookie so we can verify it on callback.
	// Uses SameSite=Lax so the cookie is sent on the top-level redirect back
	// from Google. Survives server restarts (unlike in-memory storage).
	cookies.set('oauth_state', state, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: true,
		maxAge: 600 // 10 minutes
	});

	throw redirect(302, url);
};
