import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * We need a fresh DB for this suite, separate from any dev DB.
 * Set DATABASE_URL before importing db/index so the module uses our temp path.
 * vitest isolates modules per file by default, so this is safe.
 */
const TEST_DIR = join(tmpdir(), `test-db-${process.pid}`);
const TEST_DB = join(TEST_DIR, 'test.db');

// Must be set before the module is imported
process.env.DATABASE_URL = TEST_DB;

// Dynamic import so the env var above takes effect before module evaluation
const { getConfig, setConfig, deleteConfig } = await import('./index.js');

describe('db config helpers', () => {
	beforeAll(() => {
		mkdirSync(TEST_DIR, { recursive: true });
	});

	afterAll(() => {
		if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
	});

	it('getConfig returns null for a missing key', () => {
		expect(getConfig('nonexistent_key')).toBeNull();
	});

	it('setConfig creates a new key', () => {
		setConfig('test_key', 'hello');
		expect(getConfig('test_key')).toBe('hello');
	});

	it('setConfig overwrites an existing key', () => {
		setConfig('test_key', 'hello');
		setConfig('test_key', 'world');
		expect(getConfig('test_key')).toBe('world');
	});

	it('getConfig returns the correct value for multiple keys', () => {
		setConfig('key_a', 'alpha');
		setConfig('key_b', 'beta');
		expect(getConfig('key_a')).toBe('alpha');
		expect(getConfig('key_b')).toBe('beta');
	});

	it('deleteConfig removes a key', () => {
		setConfig('to_delete', 'bye');
		expect(getConfig('to_delete')).toBe('bye');
		deleteConfig('to_delete');
		expect(getConfig('to_delete')).toBeNull();
	});

	it('deleteConfig is a no-op for a missing key', () => {
		expect(() => deleteConfig('key_that_does_not_exist')).not.toThrow();
	});

	it('stores empty string values', () => {
		setConfig('empty_val', '');
		expect(getConfig('empty_val')).toBe('');
	});

	it('stores values with special characters', () => {
		const val = 'sk-ant-oat01-ABC🔑==/+';
		setConfig('special', val);
		expect(getConfig('special')).toBe(val);
	});
});
