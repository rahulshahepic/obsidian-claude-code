import { describe, it, expect, vi, beforeEach } from 'vitest';
import { debug, getDebugLog, clearDebugLog } from './debug-logger.js';

describe('debug-logger', () => {
	beforeEach(() => {
		clearDebugLog();
		vi.spyOn(console, 'log').mockImplementation(() => {});
	});

	it('stores entries in the ring buffer', () => {
		debug('test-tag', 'hello');
		const log = getDebugLog();
		expect(log).toHaveLength(1);
		expect(log[0].tag).toBe('test-tag');
		expect(log[0].msg).toBe('hello');
		expect(log[0].ts).toBeTruthy();
	});

	it('includes data when provided', () => {
		debug('t', 'msg', { foo: 'bar' });
		const log = getDebugLog();
		expect(log[0].data).toEqual({ foo: 'bar' });
	});

	it('omits data key when not provided', () => {
		debug('t', 'msg');
		const log = getDebugLog();
		expect(log[0]).not.toHaveProperty('data');
	});

	it('respects the limit parameter', () => {
		for (let i = 0; i < 10; i++) debug('t', `msg-${i}`);
		expect(getDebugLog(3)).toHaveLength(3);
		expect(getDebugLog(3)[0].msg).toBe('msg-7');
	});

	it('evicts oldest entries when ring buffer is full', () => {
		// Push more than the default 200 entries
		for (let i = 0; i < 210; i++) debug('t', `msg-${i}`);
		const log = getDebugLog();
		expect(log.length).toBe(200);
		expect(log[0].msg).toBe('msg-10');
	});

	it('clearDebugLog empties the buffer', () => {
		debug('t', 'msg');
		expect(getDebugLog()).toHaveLength(1);
		clearDebugLog();
		expect(getDebugLog()).toHaveLength(0);
	});

	it('logs to stdout via console.log', () => {
		const spy = vi.spyOn(console, 'log');
		spy.mockClear();
		debug('my-tag', 'my-msg', { key: 'val' });
		expect(spy).toHaveBeenLastCalledWith(
			expect.stringContaining('[my-tag] my-msg {"key":"val"}')
		);
	});
});
