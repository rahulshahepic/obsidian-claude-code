import type { PageServerLoad } from './$types';
import { parseTokenExpiry } from '$lib/server/monitor.js';
import { getConfig } from '$lib/server/db/index.js';

export const load: PageServerLoad = async () => {
	const expiresAt = getConfig('claude_token_expires_at');
	const tokenRefreshedAt = getConfig('claude_token_refreshed_at');
	const vaultPath = getConfig('vault_path');
	const vaultGitUrl = getConfig('vault_git_remote');
	const tokenStatus = parseTokenExpiry(expiresAt);

	return {
		tokenStatus,
		tokenRefreshedAt,
		vaultPath,
		vaultGitUrl
	};
};
