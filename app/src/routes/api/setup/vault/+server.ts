import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { setConfig, getConfig } from '$lib/server/db/index.js';
import { mkdirSync, existsSync } from 'fs';
import { execSync } from 'child_process';

export const POST: RequestHandler = async ({ request }) => {
	if (getConfig('setup_complete') !== 'true') {
		throw error(403, 'Complete passkey and Claude auth steps first.');
	}

	const { vaultPath } = await request.json();
	if (!vaultPath || typeof vaultPath !== 'string') {
		throw error(400, 'vaultPath is required.');
	}

	const resolved = vaultPath.trim();

	// Create the directory if it doesn't exist
	mkdirSync(resolved, { recursive: true });

	// Initialise as a git repo if not already
	if (!existsSync(`${resolved}/.git`)) {
		execSync(`git init "${resolved}"`, { encoding: 'utf8' });
		execSync(`git -C "${resolved}" commit --allow-empty -m "init"`, { encoding: 'utf8' });
	}

	setConfig('vault_path', resolved);

	const publicUrl = process.env.PUBLIC_URL ?? 'http://localhost:5173';
	const gitUrl = `${publicUrl}/vault.git`;
	setConfig('vault_git_remote', gitUrl);

	return json({ gitUrl });
};
