/**
 * Vault git repository helpers.
 *
 * The vault is a regular (non-bare) git repository on the VPS host.
 * It is configured with `receive.denyCurrentBranch = updateInstead` so that
 * Obsidian Git can push directly to it via SSH without needing a separate
 * bare repo. The working tree is bind-mounted into the workspace container so
 * Claude Code can read and edit vault files directly.
 *
 * Pure helpers (buildSshGitUrl, parsePublicKey, getAuthorizedKeysPath) are
 * exported for unit testing.  IO-bound functions use execSync / fs so they
 * can be mocked in tests.
 */
import { execSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import path from 'path';

// ---------------------------------------------------------------------------
// authorized_keys marker — identifies the block managed by this app
// ---------------------------------------------------------------------------

const MARKER_BEGIN = '# === BEGIN obsidian-claude-code ===';
const MARKER_END = '# === END obsidian-claude-code ===';

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit testing)
// ---------------------------------------------------------------------------

/**
 * Build the SSH git remote URL for the vault.
 *
 * @param user      SSH username on the server (typically the OS user that owns the vault)
 * @param host      VPS hostname or IP
 * @param port      SSH port — 22 is omitted from the URL
 * @param vaultPath absolute path to the vault on the server
 */
export function buildSshGitUrl(
	user: string,
	host: string,
	port: number,
	vaultPath: string
): string {
	const portPart = port !== 22 ? `:${port}` : '';
	return `ssh://${user}@${host}${portPart}${vaultPath}`;
}

/**
 * Build the SSH git URL using environment config.
 * Reads SSH_GIT_USER (default: USER env / 'git') and SSH_PORT (default: 22).
 */
export function getSshGitUrl(host: string, vaultPath: string): string {
	const user = process.env.SSH_GIT_USER ?? process.env.USER ?? 'git';
	const port = parseInt(process.env.SSH_PORT ?? '22', 10);
	return buildSshGitUrl(user, host, port, vaultPath);
}

/**
 * Return the path to the authorized_keys file managed by this app.
 * Reads AUTHORIZED_KEYS_FILE env var; defaults to ~/.ssh/authorized_keys.
 */
export function getAuthorizedKeysPath(): string {
	return process.env.AUTHORIZED_KEYS_FILE ?? path.join(homedir(), '.ssh', 'authorized_keys');
}

/**
 * Validate an SSH public key string.
 * Returns the trimmed key on success, or null if the format is unrecognised.
 */
export function parsePublicKey(raw: string): string | null {
	const trimmed = raw.trim();
	const validPrefixes = [
		'ssh-rsa ',
		'ssh-ed25519 ',
		'ecdsa-sha2-nistp256 ',
		'ecdsa-sha2-nistp384 ',
		'ecdsa-sha2-nistp521 ',
		'sk-ssh-ed25519@openssh.com ',
		'sk-ecdsa-sha2-nistp256@openssh.com '
	];
	if (!validPrefixes.some((p) => trimmed.startsWith(p))) return null;
	// Must have at least key-type + base64 data (two whitespace-separated tokens)
	const parts = trimmed.split(/\s+/);
	if (parts.length < 2 || !parts[1]) return null;
	return trimmed;
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
 * - `git init` if not already a git repo.
 * - Sets `receive.denyCurrentBranch = updateInstead` so Obsidian Git can push
 *   to this non-bare repo via SSH (git updates the working tree on push).
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

/**
 * Write an SSH public key to the authorized_keys file.
 *
 * The key is wrapped in a managed marker block so it can be updated without
 * disturbing other entries in the file (e.g. the user's own SSH access key).
 * If the managed block already exists it is replaced; otherwise it is appended.
 */
export function writeAuthorizedKey(pubKey: string): void {
	const keysPath = getAuthorizedKeysPath();
	mkdirSync(path.dirname(keysPath), { recursive: true, mode: 0o700 });

	let existing = '';
	try {
		existing = readFileSync(keysPath, 'utf8');
	} catch {
		/* file may not exist yet */
	}

	// Remove any existing managed block
	const beginIdx = existing.indexOf(MARKER_BEGIN);
	const endIdx = existing.indexOf(MARKER_END);
	const cleaned =
		beginIdx >= 0 && endIdx > beginIdx
			? existing.slice(0, beginIdx) + existing.slice(endIdx + MARKER_END.length)
			: existing;

	const prefix = cleaned.trimEnd() ? cleaned.trimEnd() + '\n' : '';
	const newContent =
		prefix + MARKER_BEGIN + '\n' + pubKey.trim() + '\n' + MARKER_END + '\n';

	writeFileSync(keysPath, newContent, { mode: 0o600 });
}

/**
 * Read the SSH public key managed by this app from authorized_keys.
 * Returns null if no managed block is present.
 */
export function readAuthorizedKey(): string | null {
	try {
		const content = readFileSync(getAuthorizedKeysPath(), 'utf8');
		const beginIdx = content.indexOf(MARKER_BEGIN);
		const endIdx = content.indexOf(MARKER_END);
		if (beginIdx < 0 || endIdx <= beginIdx) return null;
		const key = content.slice(beginIdx + MARKER_BEGIN.length, endIdx).trim();
		return key || null;
	} catch {
		return null;
	}
}
