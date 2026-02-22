/**
 * Vault git repository helpers.
 *
 * The vault is a regular (non-bare) git repository on the VPS host.
 * It is configured with `receive.denyCurrentBranch = updateInstead` so that
 * Obsidian Git can push directly to it via HTTP without needing a separate
 * bare repo. The working tree is bind-mounted into the workspace container so
 * Claude Code can read and edit vault files directly.
 *
 * Pure helpers (buildGitUrl, parseBasicAuth, parseGitBackendResponse) are
 * exported for unit testing.  IO-bound functions (initVaultRepo, isVaultRepo)
 * use execSync / existsSync so they can be mocked in tests.
 */
import { execSync } from 'child_process';
import { existsSync } from 'fs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GitBackendResponse {
	status: number;
	headers: Record<string, string>;
	body: Buffer;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit testing)
// ---------------------------------------------------------------------------

/**
 * Build the git remote URL for the vault.
 * The app always serves the vault at `/vault.git` regardless of the
 * on-disk directory name, so this URL is deterministic.
 */
export function buildGitUrl(publicUrl: string): string {
	return `${publicUrl.replace(/\/$/, '')}/vault.git`;
}

/**
 * Parse an HTTP Basic Authorization header.
 * Returns null if the header is missing, uses a non-Basic scheme, or has
 * no colon separator in the decoded credentials.
 */
export function parseBasicAuth(
	header: string | null | undefined
): { username: string; password: string } | null {
	if (!header) return null;
	const match = header.match(/^Basic\s+(.+)$/i);
	if (!match) return null;
	try {
		const decoded = Buffer.from(match[1], 'base64').toString('utf8');
		const colonIdx = decoded.indexOf(':');
		if (colonIdx < 0) return null;
		return {
			username: decoded.slice(0, colonIdx),
			// Everything after the first colon is the password (colons are allowed)
			password: decoded.slice(colonIdx + 1)
		};
	} catch {
		return null;
	}
}

/**
 * Parse the raw stdout from `git http-backend` (CGI response format).
 *
 * The CGI output format is:
 *   Header: value\r\n
 *   Header: value\r\n
 *   \r\n
 *   <binary body>
 *
 * Returns a structured response with extracted headers, status code, and body.
 * If the blank-line separator cannot be found, returns status 500.
 */
export function parseGitBackendResponse(output: Buffer): GitBackendResponse {
	// Find the blank line separating headers from body (\r\n\r\n or \n\n)
	let bodyStart = -1;
	let headerEnd = -1;

	for (let i = 0; i < output.length - 1; i++) {
		if (
			i + 3 < output.length &&
			output[i] === 13 &&
			output[i + 1] === 10 &&
			output[i + 2] === 13 &&
			output[i + 3] === 10
		) {
			// \r\n\r\n
			headerEnd = i;
			bodyStart = i + 4;
			break;
		}
		if (output[i] === 10 && output[i + 1] === 10) {
			// \n\n
			headerEnd = i;
			bodyStart = i + 2;
			break;
		}
	}

	if (bodyStart < 0) {
		return { status: 500, headers: {}, body: output };
	}

	const headerText = output.slice(0, headerEnd).toString('utf8');
	const body = output.slice(bodyStart);
	const headers: Record<string, string> = {};
	let status = 200;

	for (const line of headerText.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		if (trimmed.startsWith('Status:')) {
			const code = parseInt(trimmed.slice(7).trim(), 10);
			if (!isNaN(code)) status = code;
		} else {
			const colon = trimmed.indexOf(':');
			if (colon > 0) {
				headers[trimmed.slice(0, colon).trim()] = trimmed.slice(colon + 1).trim();
			}
		}
	}

	return { status, headers, body };
}

// ---------------------------------------------------------------------------
// IO-bound helpers
// ---------------------------------------------------------------------------

/** Returns true if the given path is an initialized git repository. */
export function isVaultRepo(repoPath: string): boolean {
	return existsSync(`${repoPath}/.git`);
}

/**
 * Initialize the vault directory as a git repository ready to accept pushes.
 *
 * - Runs `git init` if not already a git repo.
 * - Sets `receive.denyCurrentBranch = updateInstead` so Obsidian Git can push
 *   to this non-bare repo via HTTP (git will update the working tree on push).
 * - Creates an initial empty commit so the repo has a valid HEAD ref.
 *
 * Idempotent: calling again on an existing repo only re-applies the config.
 */
export function initVaultRepo(repoPath: string): void {
	if (!isVaultRepo(repoPath)) {
		execSync(`git init "${repoPath}"`, { encoding: 'utf8' });
		// Minimal git identity needed for the initial commit
		execSync(`git -C "${repoPath}" config user.email "vault@localhost"`, { encoding: 'utf8' });
		execSync(`git -C "${repoPath}" config user.name "Vault"`, { encoding: 'utf8' });
		execSync(`git -C "${repoPath}" commit --allow-empty -m "init"`, { encoding: 'utf8' });
	}
	// Always re-apply so the config survives if the repo pre-existed without it
	execSync(`git -C "${repoPath}" config receive.denyCurrentBranch updateInstead`, {
		encoding: 'utf8'
	});
}
