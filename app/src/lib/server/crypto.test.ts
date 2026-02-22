import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { encrypt, decrypt } from './crypto.js';

describe('crypto', () => {
	describe('encrypt / decrypt round-trip', () => {
		it('recovers the original plaintext', () => {
			const plain = 'sk-ant-oat01-super-secret-token';
			expect(decrypt(encrypt(plain))).toBe(plain);
		});

		it('handles empty string', () => {
			expect(decrypt(encrypt(''))).toBe('');
		});

		it('handles unicode and long strings', () => {
			const plain = '🔑'.repeat(1000);
			expect(decrypt(encrypt(plain))).toBe(plain);
		});

		it('produces different ciphertext each call (random IV)', () => {
			const plain = 'same input';
			expect(encrypt(plain)).not.toBe(encrypt(plain));
		});
	});

	describe('decrypt error cases', () => {
		it('throws on malformed encoded string (missing separators)', () => {
			expect(() => decrypt('notvalid')).toThrow();
		});

		it('throws on tampered ciphertext (auth tag fails)', () => {
			const enc = encrypt('hello');
			const [iv, tag, ct] = enc.split(':');
			// flip last char of ciphertext
			const tampered = `${iv}:${tag}:${ct.slice(0, -1)}f`;
			expect(() => decrypt(tampered)).toThrow();
		});

		it('throws on tampered auth tag', () => {
			const enc = encrypt('hello');
			const [iv, tag, ct] = enc.split(':');
			const badTag = tag.slice(0, -1) + (tag.endsWith('a') ? 'b' : 'a');
			expect(() => decrypt(`${iv}:${badTag}:${ct}`)).toThrow();
		});
	});

	describe('ENCRYPTION_KEY validation', () => {
		const saved = process.env.ENCRYPTION_KEY;

		afterEach(() => {
			process.env.ENCRYPTION_KEY = saved;
		});

		it('throws when ENCRYPTION_KEY is missing', () => {
			delete process.env.ENCRYPTION_KEY;
			expect(() => encrypt('x')).toThrow(/ENCRYPTION_KEY/);
		});

		it('throws when ENCRYPTION_KEY is too short', () => {
			process.env.ENCRYPTION_KEY = 'short';
			expect(() => encrypt('x')).toThrow(/ENCRYPTION_KEY/);
		});
	});
});
