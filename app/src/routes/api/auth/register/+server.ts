import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	beginRegistration,
	completeRegistration,
	getStoredCredential
} from '$lib/server/auth/webauthn.js';
import { getConfig } from '$lib/server/db/index.js';

/** GET — start registration: returns PublicKeyCredentialCreationOptionsJSON */
export const GET: RequestHandler = async () => {
	// Prevent re-registration if already set up (must use /settings to manage credentials)
	if (getConfig('setup_complete') === 'true' && getStoredCredential()) {
		throw error(403, 'Already registered. Use settings to manage your passkey.');
	}
	const options = await beginRegistration();
	return json(options);
};

/** POST — complete registration with the authenticator response */
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const result = await completeRegistration(body);
	if (!result.verified) {
		throw error(400, 'Passkey registration failed — response could not be verified.');
	}
	return json({ verified: true });
};
