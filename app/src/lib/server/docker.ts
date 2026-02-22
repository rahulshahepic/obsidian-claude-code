/**
 * Docker workspace container lifecycle helpers.
 *
 * The workspace container runs the Claude Code CLI and has the vault
 * bind-mounted at /vault. It is started once and kept alive across sessions.
 *
 * Pure helpers (parseInspectStatus) are exported for unit testing.
 * IO-bound functions use execSync so they can be mocked in tests.
 */
import { execSync } from 'child_process';

export const CONTAINER_NAME = process.env.CLAUDE_WORKSPACE_CONTAINER ?? 'claude-workspace';
export const IMAGE_NAME = process.env.CLAUDE_WORKSPACE_IMAGE ?? 'claude-workspace';
const VAULTS_DIR = process.env.VAULTS_DIR ?? '/var/vault';

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit testing)
// ---------------------------------------------------------------------------

export type ContainerState = 'running' | 'stopped' | 'missing';

/** Parse `docker inspect --format '{{.State.Status}}'` output. */
export function parseInspectStatus(raw: string): ContainerState {
	const status = raw.trim().toLowerCase();
	if (status === 'running') return 'running';
	if (status === '' || status === 'no such object' || status.startsWith('error')) return 'missing';
	return 'stopped';
}

// ---------------------------------------------------------------------------
// IO-bound lifecycle functions
// ---------------------------------------------------------------------------

/** Returns the current state of the workspace container. */
export function getContainerState(): ContainerState {
	try {
		const out = execSync(
			`docker inspect --format '{{.State.Status}}' ${CONTAINER_NAME} 2>&1`,
			{ encoding: 'utf8', timeout: 5000 }
		);
		return parseInspectStatus(out);
	} catch {
		return 'missing';
	}
}

/**
 * Ensure the workspace container is running.
 * - If running: no-op.
 * - If stopped: `docker start`.
 * - If missing: `docker run -d` with resource limits.
 */
export function ensureContainerRunning(): void {
	const state = getContainerState();
	if (state === 'running') return;

	if (state === 'stopped') {
		execSync(`docker start ${CONTAINER_NAME}`, { timeout: 30_000 });
		return;
	}

	// Missing — create and start
	execSync(
		[
			'docker run -d',
			`--name ${CONTAINER_NAME}`,
			'--memory=1g',
			'--cpus=1.0',
			'--pids-limit=200',
			`-v ${VAULTS_DIR}:/vault`,
			IMAGE_NAME
		].join(' '),
		{ timeout: 60_000 }
	);
}

/** Stop the workspace container (does not remove it). */
export function stopContainer(): void {
	try {
		execSync(`docker stop ${CONTAINER_NAME}`, { timeout: 30_000 });
	} catch {
		// Already stopped — ignore
	}
}
