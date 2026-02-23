import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHmac } from 'crypto';
import { createWsTicket, isValidWsTicket } from './ws-ticket.js';

const VALID_SECRET = 'a'.repeat(32);

describe('ws-ticket', () => {
	const savedSecret = process.env.APP_SECRET;

	afterEach(() => {
		process.env.APP_SECRET = savedSecret;
		vi.useRealTimers();
	});

	// ---------------------------------------------------------------------------
	// createWsTicket
	// ---------------------------------------------------------------------------

	describe('createWsTicket', () => {
		it('produces three dot-separated segments', () => {
			process.env.APP_SECRET = VALID_SECRET;
			expect(createWsTicket().split('.')).toHaveLength(3);
		});

		it('each call returns a different ticket (random nonce)', () => {
			process.env.APP_SECRET = VALID_SECRET;
			expect(createWsTicket()).not.toBe(createWsTicket());
		});
	});

	// ---------------------------------------------------------------------------
	// isValidWsTicket — happy path
	// ---------------------------------------------------------------------------

	describe('isValidWsTicket — valid ticket', () => {
		it('accepts a freshly created ticket', () => {
			process.env.APP_SECRET = VALID_SECRET;
			expect(isValidWsTicket(createWsTicket())).toBe(true);
		});
	});

	// ---------------------------------------------------------------------------
	// isValidWsTicket — APP_SECRET guard (first branch)
	// ---------------------------------------------------------------------------

	describe('isValidWsTicket — secret guard', () => {
		it('returns false when APP_SECRET is absent', () => {
			delete process.env.APP_SECRET;
			expect(isValidWsTicket('ts.nonce.mac')).toBe(false);
		});

		it('returns false when APP_SECRET is shorter than 32 chars', () => {
			process.env.APP_SECRET = 'tooshort';
			expect(isValidWsTicket('ts.nonce.mac')).toBe(false);
		});
	});

	// ---------------------------------------------------------------------------
	// isValidWsTicket — structural checks
	// ---------------------------------------------------------------------------

	describe('isValidWsTicket — structure', () => {
		it('returns false when ticket contains no dots', () => {
			process.env.APP_SECRET = VALID_SECRET;
			expect(isValidWsTicket('nodots')).toBe(false);
		});

		it('returns false for empty string', () => {
			process.env.APP_SECRET = VALID_SECRET;
			expect(isValidWsTicket('')).toBe(false);
		});
	});

	// ---------------------------------------------------------------------------
	// isValidWsTicket — HMAC verification
	// ---------------------------------------------------------------------------

	describe('isValidWsTicket — HMAC checks', () => {
		it('returns false when HMAC is tampered (same length, wrong bytes)', () => {
			process.env.APP_SECRET = VALID_SECRET;
			const ticket = createWsTicket();
			const parts = ticket.split('.');
			const mac = parts[2];
			// Flip the last character while keeping the same length
			const badChar = mac.at(-1) === 'a' ? 'b' : 'a';
			const tampered = `${parts[0]}.${parts[1]}.${mac.slice(0, -1)}${badChar}`;
			expect(isValidWsTicket(tampered)).toBe(false);
		});

		it('returns false when HMAC is truncated (different length → timingSafeEqual throws)', () => {
			process.env.APP_SECRET = VALID_SECRET;
			const ticket = createWsTicket();
			const parts = ticket.split('.');
			// Shorter MAC causes timingSafeEqual to throw; the catch returns false
			const truncated = `${parts[0]}.${parts[1]}.${parts[2].slice(0, -4)}`;
			expect(isValidWsTicket(truncated)).toBe(false);
		});

		it('returns false when signed with a different secret', () => {
			process.env.APP_SECRET = 'b'.repeat(32);
			const ticket = createWsTicket();
			process.env.APP_SECRET = VALID_SECRET;
			expect(isValidWsTicket(ticket)).toBe(false);
		});
	});

	// ---------------------------------------------------------------------------
	// isValidWsTicket — payload structure checks (run after HMAC passes)
	// ---------------------------------------------------------------------------

	describe('isValidWsTicket — payload structure', () => {
		/** Build a correctly-signed ticket from an arbitrary payload string. */
		function makeTicket(payload: string): string {
			const mac = createHmac('sha256', VALID_SECRET).update(payload).digest('base64url');
			return `${payload}.${mac}`;
		}

		beforeEach(() => {
			process.env.APP_SECRET = VALID_SECRET;
		});

		it('returns false when payload has no dot (no nonce separator, firstDot === -1)', () => {
			// payload = "justtimestamp" — no dot, so firstDot check fails
			expect(isValidWsTicket(makeTicket('justtimestamp'))).toBe(false);
		});

		it('returns false when timestamp segment is empty (parseInt returns NaN)', () => {
			// payload = ".somenonce" — empty string before first dot → NaN
			expect(isValidWsTicket(makeTicket('.somenonce'))).toBe(false);
		});
	});

	// ---------------------------------------------------------------------------
	// isValidWsTicket — expiry
	// ---------------------------------------------------------------------------

	describe('isValidWsTicket — expiry', () => {
		it('returns false for a ticket older than 30 seconds', () => {
			process.env.APP_SECRET = VALID_SECRET;
			vi.useFakeTimers();
			vi.setSystemTime(new Date('2024-06-01T12:00:00.000Z'));
			const ticket = createWsTicket();

			vi.setSystemTime(new Date('2024-06-01T12:00:31.000Z')); // 31 s later
			expect(isValidWsTicket(ticket)).toBe(false);
		});

		it('accepts a ticket just within the 30-second window', () => {
			process.env.APP_SECRET = VALID_SECRET;
			vi.useFakeTimers();
			vi.setSystemTime(new Date('2024-06-01T12:00:00.000Z'));
			const ticket = createWsTicket();

			vi.setSystemTime(new Date('2024-06-01T12:00:29.000Z')); // 29 s later
			expect(isValidWsTicket(ticket)).toBe(true);
		});
	});
});
