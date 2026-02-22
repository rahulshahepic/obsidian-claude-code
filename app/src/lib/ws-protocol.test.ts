import { describe, it, expect } from 'vitest';
import { isClientMsg } from './ws-protocol.js';

describe('isClientMsg', () => {
	it('accepts a message msg', () => {
		expect(isClientMsg({ type: 'message', content: 'hi' })).toBe(true);
	});

	it('accepts a permission_response msg', () => {
		expect(isClientMsg({ type: 'permission_response', id: 'x', allow: true })).toBe(true);
	});

	it('accepts an interrupt msg', () => {
		expect(isClientMsg({ type: 'interrupt' })).toBe(true);
	});

	it('rejects unknown type', () => {
		expect(isClientMsg({ type: 'unknown' })).toBe(false);
	});

	it('rejects null', () => {
		expect(isClientMsg(null)).toBe(false);
	});

	it('rejects non-object', () => {
		expect(isClientMsg('string')).toBe(false);
		expect(isClientMsg(42)).toBe(false);
	});
});
