import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { beginAuthentication, completeAuthentication } from '$lib/server/auth/webauthn.js';
import { createSession } from '$lib/server/auth/session.js';

/** GET — start authentication: returns PublicKeyCredentialRequestOptionsJSON */
export const GET: RequestHandler = async () => {
	const options = await beginAuthentication();
	return json(options);
};

/** POST — complete authentication; sets session cookie on success */
export const POST: RequestHandler = async ({ request, cookies }) => {
	const body = await request.json();
	const result = await completeAuthentication(body);
	if (!result.verified) {
		throw error(401, 'Authentication failed.');
	}
	createSession(cookies);
	return json({ verified: true });
};
