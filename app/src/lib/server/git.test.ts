import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildGitUrl, parseBasicAuth, parseGitBackendResponse } from './git.js';

// ---------------------------------------------------------------------------
// Mock child_process and fs for IO-bound tests
// ---------------------------------------------------------------------------

const mockExecSync = vi.hoisted(() => vi.fn());
vi.mock('child_process', () => ({ execSync: mockExecSync }));

const mockExistsSync = vi.hoisted(() => vi.fn());
vi.mock('fs', () => ({ existsSync: mockExistsSync }));

// Re-import after mocking so the module uses the mocked dependencies
const { isVaultRepo, initVaultRepo } = await import('./git.js');

// ---------------------------------------------------------------------------
// buildGitUrl
// ---------------------------------------------------------------------------

describe('buildGitUrl', () => {
	it('appends /vault.git to the public URL', () => {
		expect(buildGitUrl('https://example.com')).toBe('https://example.com/vault.git');
	});

	it('strips a trailing slash before appending', () => {
		expect(buildGitUrl('https://example.com/')).toBe('https://example.com/vault.git');
	});

	it('works with localhost dev URLs', () => {
		expect(buildGitUrl('http://localhost:5173')).toBe('http://localhost:5173/vault.git');
	});

	it('works with URLs that have a path prefix', () => {
		expect(buildGitUrl('https://example.com/app')).toBe('https://example.com/app/vault.git');
	});
});

// ---------------------------------------------------------------------------
// parseBasicAuth
// ---------------------------------------------------------------------------

describe('parseBasicAuth', () => {
	it('returns null for a null header', () => {
		expect(parseBasicAuth(null)).toBeNull();
	});

	it('returns null for an undefined header', () => {
		expect(parseBasicAuth(undefined)).toBeNull();
	});

	it('returns null for an empty string', () => {
		expect(parseBasicAuth('')).toBeNull();
	});

	it('returns null for a Bearer token (non-Basic scheme)', () => {
		expect(parseBasicAuth('Bearer some-token')).toBeNull();
	});

	it('parses a valid Basic auth header', () => {
		const encoded = Buffer.from('git:s3cr3t').toString('base64');
		expect(parseBasicAuth(`Basic ${encoded}`)).toEqual({ username: 'git', password: 's3cr3t' });
	});

	it('handles a password that contains colons (split on first colon only)', () => {
		const encoded = Buffer.from('user:pass:with:colons').toString('base64');
		expect(parseBasicAuth(`Basic ${encoded}`)).toEqual({
			username: 'user',
			password: 'pass:with:colons'
		});
	});

	it('returns null when the decoded value has no colon', () => {
		const encoded = Buffer.from('nocolon').toString('base64');
		expect(parseBasicAuth(`Basic ${encoded}`)).toBeNull();
	});

	it('is case-insensitive for the scheme prefix', () => {
		const encoded = Buffer.from('u:p').toString('base64');
		expect(parseBasicAuth(`basic ${encoded}`)).toEqual({ username: 'u', password: 'p' });
	});
});

// ---------------------------------------------------------------------------
// parseGitBackendResponse
// ---------------------------------------------------------------------------

describe('parseGitBackendResponse', () => {
	it('parses a simple response with \\n\\n separator', () => {
		const raw = 'Content-Type: text/plain\n\nhello';
		const buf = Buffer.from(raw);
		const result = parseGitBackendResponse(buf);
		expect(result.status).toBe(200);
		expect(result.headers['Content-Type']).toBe('text/plain');
		expect(result.body.toString()).toBe('hello');
	});

	it('parses a response with \\r\\n\\r\\n separator', () => {
		const raw = 'Content-Type: application/x-git-upload-pack-advertisement\r\n\r\nbinary';
		const buf = Buffer.from(raw);
		const result = parseGitBackendResponse(buf);
		expect(result.status).toBe(200);
		expect(result.headers['Content-Type']).toBe(
			'application/x-git-upload-pack-advertisement'
		);
		expect(result.body.toString()).toBe('binary');
	});

	it('extracts a Status header and converts it to the numeric status code', () => {
		const raw = 'Status: 403 Forbidden\nContent-Type: text/plain\n\nForbidden';
		const result = parseGitBackendResponse(Buffer.from(raw));
		expect(result.status).toBe(403);
	});

	it('defaults status to 200 when no Status header is present', () => {
		const result = parseGitBackendResponse(Buffer.from('X-Custom: yes\n\nbody'));
		expect(result.status).toBe(200);
	});

	it('returns status 500 and the raw buffer when no blank-line separator is found', () => {
		const raw = Buffer.from('no-separator-here');
		const result = parseGitBackendResponse(raw);
		expect(result.status).toBe(500);
		expect(result.body).toBe(raw);
	});

	it('handles a binary body correctly (does not corrupt bytes)', () => {
		const header = 'Content-Type: application/octet-stream\n\n';
		const body = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe]);
		const full = Buffer.concat([Buffer.from(header), body]);
		const result = parseGitBackendResponse(full);
		expect(result.body).toEqual(body);
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

	it('runs git init and creates an initial commit for a new (non-existing) repo', () => {
		mockExistsSync.mockReturnValueOnce(false); // isVaultRepo → false
		mockExecSync.mockReturnValue('');

		initVaultRepo('/var/vault');

		// Calls: git init, user.email, user.name, commit, receive.denyCurrentBranch
		expect(mockExecSync).toHaveBeenCalledTimes(5);
		expect(mockExecSync.mock.calls[0][0]).toMatch(/git init/);
		expect(mockExecSync.mock.calls[1][0]).toMatch(/user\.email/);
		expect(mockExecSync.mock.calls[2][0]).toMatch(/user\.name/);
		expect(mockExecSync.mock.calls[3][0]).toMatch(/commit --allow-empty/);
		expect(mockExecSync.mock.calls[4][0]).toMatch(/receive\.denyCurrentBranch/);
	});

	it('skips git init for an existing repo but still applies the push config', () => {
		mockExistsSync.mockReturnValueOnce(true); // isVaultRepo → true
		mockExecSync.mockReturnValue('');

		initVaultRepo('/var/vault');

		// Only the config call should be made
		expect(mockExecSync).toHaveBeenCalledTimes(1);
		expect(mockExecSync.mock.calls[0][0]).toMatch(/receive\.denyCurrentBranch/);
	});

	it('sets receive.denyCurrentBranch to updateInstead', () => {
		mockExistsSync.mockReturnValueOnce(true);
		mockExecSync.mockReturnValue('');

		initVaultRepo('/var/vault');

		const configCall = mockExecSync.mock.calls[0][0] as string;
		expect(configCall).toContain('updateInstead');
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
