import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { setConfig } from '$lib/server/db/index.js';
import { mkdirSync } from 'fs';
import { initVaultRepo, buildGitUrl } from '$lib/server/git.js';

export const POST: RequestHandler = async ({ request }) => {
	const { vaultPath } = await request.json();
	if (!vaultPath || typeof vaultPath !== 'string') {
		throw error(400, 'vaultPath is required.');
	}

	const resolved = vaultPath.trim();

	// Create the directory if it doesn't exist
	mkdirSync(resolved, { recursive: true });

	// Initialise as a git repo configured to accept Obsidian Git pushes
	initVaultRepo(resolved);

	setConfig('vault_path', resolved);

	const publicUrl = process.env.PUBLIC_URL ?? 'http://localhost:5173';
	const gitUrl = buildGitUrl(publicUrl);
	setConfig('vault_git_remote', gitUrl);

	// Mark setup as complete now that all required steps are done
	setConfig('setup_complete', 'true');

	return json({ gitUrl });
};
