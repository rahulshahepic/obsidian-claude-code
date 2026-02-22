/**
 * Session cookie management.
 * A session is a signed random token stored in an HttpOnly cookie.
 * Single-user: "logged in" simply means the valid session cookie is present.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import type { Cookies } from '@sveltejs/kit';

const COOKIE_NAME = 'session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function getSecret(): string {
	const s = process.env.APP_SECRET;
	if (!s || s.length < 32) throw new Error('APP_SECRET env var must be at least 32 characters.');
	return s;
}

function sign(token: string): string {
	const mac = createHmac('sha256', getSecret()).update(token).digest('base64url');
	return `${token}.${mac}`;
}

function verify(signed: string): string | null {
	const dot = signed.lastIndexOf('.');
	if (dot === -1) return null;
	const token = signed.slice(0, dot);
	const expected = sign(token);
	try {
		if (timingSafeEqual(Buffer.from(signed), Buffer.from(expected))) return token;
	} catch {
		// length mismatch → not equal
	}
	return null;
}

export function createSession(cookies: Cookies): void {
	const token = randomBytes(32).toString('base64url');
	const signed = sign(token);
	cookies.set(COOKIE_NAME, signed, {
		path: '/',
		httpOnly: true,
		secure: process.env.NODE_ENV === 'production',
		sameSite: 'lax',
		maxAge: SESSION_MAX_AGE
	});
}

export function getSession(cookies: Cookies): boolean {
	const signed = cookies.get(COOKIE_NAME);
	if (!signed) return false;
	return verify(signed) !== null;
}

export function destroySession(cookies: Cookies): void {
	cookies.delete(COOKIE_NAME, { path: '/' });
}
