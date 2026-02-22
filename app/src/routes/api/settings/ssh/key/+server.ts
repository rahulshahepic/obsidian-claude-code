import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { setConfig } from '$lib/server/db/index.js';
import { parsePublicKey, writeAuthorizedKey } from '$lib/server/git.js';

export const POST: RequestHandler = async ({ request }) => {
	const { pubKey } = await request.json();
	if (!pubKey || typeof pubKey !== 'string') {
		throw error(400, 'pubKey is required.');
	}

	const validated = parsePublicKey(pubKey);
	if (!validated) {
		throw error(400, 'Invalid SSH public key. Expected ssh-ed25519, ssh-rsa, or ecdsa-* format.');
	}

	// Persist in DB so the settings page can display it, and write to authorized_keys
	setConfig('vault_ssh_pubkey', validated);
	writeAuthorizedKey(validated);

	return json({ ok: true });
};
