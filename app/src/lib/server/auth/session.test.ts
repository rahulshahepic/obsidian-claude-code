import { describe, it, expect, afterEach } from 'vitest';
import { createSession, getSession, destroySession } from './session.js';
import type { Cookies } from '@sveltejs/kit';

// Minimal mock that satisfies the Cookies interface surface we use
function mockCookies(): { cookies: Cookies; store: Map<string, string> } {
	const store = new Map<string, string>();
	const cookies: Cookies = {
		set: (name, value) => { store.set(name, value); },
		get: (name) => store.get(name),
		delete: (name) => { store.delete(name); },
		getAll: () => [...store.entries()].map(([name, value]) => ({ name, value })),
		serialize: () => { throw new Error('not implemented'); }
	} as unknown as Cookies;
	return { cookies, store };
}

describe('session', () => {
	const savedSecret = process.env.APP_SECRET;
	afterEach(() => { process.env.APP_SECRET = savedSecret; });

	describe('createSession', () => {
		it('sets a session cookie', () => {
			const { cookies, store } = mockCookies();
			createSession(cookies);
			expect(store.has('session')).toBe(true);
		});

		it('sets a non-empty signed value', () => {
			const { cookies, store } = mockCookies();
			createSession(cookies);
			const value = store.get('session')!;
			expect(value.length).toBeGreaterThan(40);
			expect(value).toContain('.');
		});
	});

	describe('getSession', () => {
		it('returns true for a valid session cookie', () => {
			const { cookies } = mockCookies();
			createSession(cookies);
			expect(getSession(cookies)).toBe(true);
		});

		it('returns false when no cookie is present', () => {
			const { cookies } = mockCookies();
			expect(getSession(cookies)).toBe(false);
		});

		it('returns false for a tampered cookie (flipped last char)', () => {
			const { cookies, store } = mockCookies();
			createSession(cookies);
			const original = store.get('session')!;
			const tampered = original.slice(0, -1) + (original.endsWith('a') ? 'b' : 'a');
			store.set('session', tampered);
			expect(getSession(cookies)).toBe(false);
		});

		it('returns false for a cookie with no dot separator', () => {
			const { cookies, store } = mockCookies();
			store.set('session', 'nodotinthisvalue');
			expect(getSession(cookies)).toBe(false);
		});

		it('returns false for a cookie signed with a different secret', () => {
			const { cookies, store } = mockCookies();
			createSession(cookies);
			// Change secret — the stored cookie was signed with a different key
			process.env.APP_SECRET = 'a-completely-different-secret-value-for-testing-purposes';
			expect(getSession(cookies)).toBe(false);
			// Restore
			store.delete('session');
		});
	});

	describe('destroySession', () => {
		it('removes the session cookie', () => {
			const { cookies, store } = mockCookies();
			createSession(cookies);
			expect(store.has('session')).toBe(true);
			destroySession(cookies);
			expect(store.has('session')).toBe(false);
		});

		it('is a no-op when no cookie exists', () => {
			const { cookies } = mockCookies();
			expect(() => destroySession(cookies)).not.toThrow();
		});
	});

	describe('APP_SECRET validation', () => {
		it('throws when APP_SECRET is missing', () => {
			delete process.env.APP_SECRET;
			const { cookies } = mockCookies();
			expect(() => createSession(cookies)).toThrow(/APP_SECRET/);
		});

		it('throws when APP_SECRET is too short', () => {
			process.env.APP_SECRET = 'short';
			const { cookies } = mockCookies();
			expect(() => createSession(cookies)).toThrow(/APP_SECRET/);
		});
	});
});
