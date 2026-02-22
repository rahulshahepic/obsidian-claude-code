import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import {
	beginRegistration,
	completeRegistration,
	getStoredCredential
} from '$lib/server/auth/webauthn.js';
import { getConfig } from '$lib/server/db/index.js';

function checkSetupToken(request: Request) {
	const required = env.SETUP_TOKEN;
	if (!required) return; // not configured — allow (dev / legacy installs)
	const provided = request.headers.get('x-setup-token');
	if (!provided || provided !== required) {
		throw error(403, 'Invalid setup token.');
	}
}

/** GET — start registration: returns PublicKeyCredentialCreationOptionsJSON */
export const GET: RequestHandler = async ({ request }) => {
	// Prevent re-registration if already set up (must use /settings to manage credentials)
	if (getConfig('setup_complete') === 'true' && getStoredCredential()) {
		throw error(403, 'Already registered. Use settings to manage your passkey.');
	}
	checkSetupToken(request);
	const options = await beginRegistration();
	return json(options);
};

/** POST — complete registration with the authenticator response */
export const POST: RequestHandler = async ({ request }) => {
	checkSetupToken(request);
	const body = await request.json();
	const result = await completeRegistration(body);
	if (!result.verified) {
		throw error(400, 'Passkey registration failed — response could not be verified.');
	}
	return json({ verified: true });
};
