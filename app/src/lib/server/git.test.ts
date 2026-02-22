import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildSshGitUrl, parsePublicKey, getAuthorizedKeysPath } from './git.js';

// ---------------------------------------------------------------------------
// Mock child_process and fs for IO-bound tests
// ---------------------------------------------------------------------------

const mockExecSync = vi.hoisted(() => vi.fn());
vi.mock('child_process', () => ({ execSync: mockExecSync }));

const mockExistsSync = vi.hoisted(() => vi.fn());
const mockMkdirSync = vi.hoisted(() => vi.fn());
const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());
vi.mock('fs', () => ({
	existsSync: mockExistsSync,
	mkdirSync: mockMkdirSync,
	readFileSync: mockReadFileSync,
	writeFileSync: mockWriteFileSync
}));

const mockHomedir = vi.hoisted(() => vi.fn(() => '/home/testuser'));
vi.mock('os', () => ({ homedir: mockHomedir }));

// Re-import after mocking so the module uses the mocked dependencies
const { isVaultRepo, initVaultRepo, writeAuthorizedKey, readAuthorizedKey } = await import(
	'./git.js'
);

// ---------------------------------------------------------------------------
// buildSshGitUrl
// ---------------------------------------------------------------------------

describe('buildSshGitUrl', () => {
	it('builds a standard SSH URL on the default port', () => {
		expect(buildSshGitUrl('git', 'example.com', 22, '/var/vault')).toBe(
			'ssh://git@example.com/var/vault'
		);
	});

	it('omits port 22 from the URL', () => {
		const url = buildSshGitUrl('git', 'example.com', 22, '/var/vault');
		expect(url).not.toContain(':22');
	});

	it('includes a non-standard port in the URL', () => {
		expect(buildSshGitUrl('git', 'example.com', 2222, '/var/vault')).toBe(
			'ssh://git@example.com:2222/var/vault'
		);
	});

	it('uses the provided username', () => {
		expect(buildSshGitUrl('ubuntu', 'my-vps.com', 22, '/vault')).toBe(
			'ssh://ubuntu@my-vps.com/vault'
		);
	});
});

// ---------------------------------------------------------------------------
// parsePublicKey
// ---------------------------------------------------------------------------

describe('parsePublicKey', () => {
	it('accepts a valid ssh-ed25519 key', () => {
		const key = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExampleKeyData user@host';
		expect(parsePublicKey(key)).toBe(key);
	});

	it('accepts a valid ssh-rsa key', () => {
		const key = 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQC... user@host';
		expect(parsePublicKey(key)).toBe(key);
	});

	it('accepts ecdsa-sha2-nistp256 key', () => {
		const key = 'ecdsa-sha2-nistp256 AAAAE2Vj... user@host';
		expect(parsePublicKey(key)).toBe(key);
	});

	it('trims surrounding whitespace from the key', () => {
		const key = '  ssh-ed25519 AAAAC3 comment  \n';
		expect(parsePublicKey(key)).toBe('ssh-ed25519 AAAAC3 comment');
	});

	it('returns null for an empty string', () => {
		expect(parsePublicKey('')).toBeNull();
	});

	it('returns null for an unrecognised key type', () => {
		expect(parsePublicKey('pgp-key AAAAB3...')).toBeNull();
	});

	it('returns null when the key has only the type and no data', () => {
		expect(parsePublicKey('ssh-ed25519')).toBeNull();
		expect(parsePublicKey('ssh-ed25519 ')).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// getAuthorizedKeysPath
// ---------------------------------------------------------------------------

describe('getAuthorizedKeysPath', () => {
	afterEach(() => {
		delete process.env.AUTHORIZED_KEYS_FILE;
	});

	it('returns the AUTHORIZED_KEYS_FILE env var when set', () => {
		process.env.AUTHORIZED_KEYS_FILE = '/custom/authorized_keys';
		expect(getAuthorizedKeysPath()).toBe('/custom/authorized_keys');
	});

	it('defaults to ~/.ssh/authorized_keys when env var is absent', () => {
		delete process.env.AUTHORIZED_KEYS_FILE;
		// mockHomedir returns '/home/testuser'
		expect(getAuthorizedKeysPath()).toBe('/home/testuser/.ssh/authorized_keys');
	});
});

// ---------------------------------------------------------------------------
// isVaultRepo
// ---------------------------------------------------------------------------

describe('isVaultRepo', () => {
	beforeEach(() => mockExistsSync.mockReset());

	it('returns true when the .git directory exists', () => {
		mockExistsSync.mockReturnValueOnce(true);
		expect(isVaultRepo('/var/vault')).toBe(true);
		expect(mockExistsSync).toHaveBeenCalledWith('/var/vault/.git');
	});

	it('returns false when the .git directory does not exist', () => {
		mockExistsSync.mockReturnValueOnce(false);
		expect(isVaultRepo('/var/vault')).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// initVaultRepo
// ---------------------------------------------------------------------------

describe('initVaultRepo', () => {
	beforeEach(() => {
		mockExecSync.mockReset();
		mockExistsSync.mockReset();
	});

	it('runs git init and creates an initial commit for a new repo', () => {
		mockExistsSync.mockReturnValueOnce(false);
		mockExecSync.mockReturnValue('');

		initVaultRepo('/var/vault');

		expect(mockExecSync).toHaveBeenCalledTimes(5);
		expect(mockExecSync.mock.calls[0][0]).toMatch(/git init/);
		expect(mockExecSync.mock.calls[1][0]).toMatch(/user\.email/);
		expect(mockExecSync.mock.calls[2][0]).toMatch(/user\.name/);
		expect(mockExecSync.mock.calls[3][0]).toMatch(/commit --allow-empty/);
		expect(mockExecSync.mock.calls[4][0]).toMatch(/receive\.denyCurrentBranch/);
	});

	it('skips git init for an existing repo but still applies the push config', () => {
		mockExistsSync.mockReturnValueOnce(true);
		mockExecSync.mockReturnValue('');

		initVaultRepo('/var/vault');

		expect(mockExecSync).toHaveBeenCalledTimes(1);
		expect(mockExecSync.mock.calls[0][0]).toMatch(/receive\.denyCurrentBranch/);
	});

	it('sets receive.denyCurrentBranch to updateInstead', () => {
		mockExistsSync.mockReturnValueOnce(true);
		mockExecSync.mockReturnValue('');

		initVaultRepo('/var/vault');

		expect(mockExecSync.mock.calls[0][0] as string).toContain('updateInstead');
	});

	it('includes the repo path in all git commands', () => {
		mockExistsSync.mockReturnValueOnce(false);
		mockExecSync.mockReturnValue('');

		initVaultRepo('/my/custom/vault');

		for (const call of mockExecSync.mock.calls) {
			expect(call[0] as string).toContain('/my/custom/vault');
		}
	});
});

// ---------------------------------------------------------------------------
// writeAuthorizedKey
// ---------------------------------------------------------------------------

describe('writeAuthorizedKey', () => {
	const TEST_KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5 test@host';
	const MARKER_BEGIN = '# === BEGIN obsidian-claude-code ===';
	const MARKER_END = '# === END obsidian-claude-code ===';

	beforeEach(() => {
		mockMkdirSync.mockReset();
		mockReadFileSync.mockReset();
		mockWriteFileSync.mockReset();
		process.env.AUTHORIZED_KEYS_FILE = '/home/testuser/.ssh/authorized_keys';
	});

	afterEach(() => {
		delete process.env.AUTHORIZED_KEYS_FILE;
	});

	it('creates the file with just the managed block when authorized_keys does not exist', () => {
		mockReadFileSync.mockImplementation(() => {
			throw new Error('ENOENT');
		});

		writeAuthorizedKey(TEST_KEY);

		const written = mockWriteFileSync.mock.calls[0][1] as string;
		expect(written).toContain(MARKER_BEGIN);
		expect(written).toContain(TEST_KEY);
		expect(written).toContain(MARKER_END);
	});

	it('appends the managed block to existing content', () => {
		mockReadFileSync.mockReturnValueOnce('ssh-rsa AAAAB3 existing@user\n');

		writeAuthorizedKey(TEST_KEY);

		const written = mockWriteFileSync.mock.calls[0][1] as string;
		expect(written).toContain('existing@user');
		expect(written).toContain(TEST_KEY);
		expect(written).toContain(MARKER_BEGIN);
	});

	it('replaces a previously written managed block', () => {
		const OLD_KEY = 'ssh-ed25519 AAAAC3 old@host';
		mockReadFileSync.mockReturnValueOnce(
			`${MARKER_BEGIN}\n${OLD_KEY}\n${MARKER_END}\n`
		);

		writeAuthorizedKey(TEST_KEY);

		const written = mockWriteFileSync.mock.calls[0][1] as string;
		expect(written).not.toContain(OLD_KEY);
		expect(written).toContain(TEST_KEY);
	});

	it('writes the file with restrictive 0o600 permissions', () => {
		mockReadFileSync.mockImplementation(() => {
			throw new Error('ENOENT');
		});

		writeAuthorizedKey(TEST_KEY);

		expect(mockWriteFileSync).toHaveBeenCalledWith(
			expect.any(String),
			expect.any(String),
			{ mode: 0o600 }
		);
	});

	it('creates the .ssh directory with 0o700 permissions if missing', () => {
		mockReadFileSync.mockImplementation(() => {
			throw new Error('ENOENT');
		});

		writeAuthorizedKey(TEST_KEY);

		expect(mockMkdirSync).toHaveBeenCalledWith(expect.any(String), {
			recursive: true,
			mode: 0o700
		});
	});
});

// ---------------------------------------------------------------------------
// readAuthorizedKey
// ---------------------------------------------------------------------------

describe('readAuthorizedKey', () => {
	const TEST_KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5 test@host';
	const MARKER_BEGIN = '# === BEGIN obsidian-claude-code ===';
	const MARKER_END = '# === END obsidian-claude-code ===';

	beforeEach(() => {
		mockReadFileSync.mockReset();
		process.env.AUTHORIZED_KEYS_FILE = '/home/testuser/.ssh/authorized_keys';
	});

	afterEach(() => {
		delete process.env.AUTHORIZED_KEYS_FILE;
	});

	it('returns null when the file does not exist', () => {
		mockReadFileSync.mockImplementation(() => {
			throw new Error('ENOENT');
		});
		expect(readAuthorizedKey()).toBeNull();
	});

	it('returns null when the file has no managed block', () => {
		mockReadFileSync.mockReturnValueOnce('ssh-rsa AAAA existing@user\n');
		expect(readAuthorizedKey()).toBeNull();
	});

	it('returns the key from the managed block', () => {
		mockReadFileSync.mockReturnValueOnce(
			`${MARKER_BEGIN}\n${TEST_KEY}\n${MARKER_END}\n`
		);
		expect(readAuthorizedKey()).toBe(TEST_KEY);
	});

	it('ignores content outside the managed block', () => {
		mockReadFileSync.mockReturnValueOnce(
			`ssh-rsa AAAA other@user\n${MARKER_BEGIN}\n${TEST_KEY}\n${MARKER_END}\n`
		);
		expect(readAuthorizedKey()).toBe(TEST_KEY);
	});
});
