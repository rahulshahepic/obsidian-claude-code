import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseInspectStatus } from './docker.js';

// IO-bound functions (ensureContainerRunning, stopContainer, getContainerState)
// use execSync — mock it for the IO tests.
const mockExecSync = vi.hoisted(() => vi.fn());
vi.mock('child_process', () => ({ execSync: mockExecSync }));

// Re-import after mocking so we get the mocked module.
const { getContainerState, ensureContainerRunning, stopContainer } = await import('./docker.js');

describe('parseInspectStatus', () => {
	it('returns "running" for "running"', () => {
		expect(parseInspectStatus('running')).toBe('running');
	});

	it('returns "running" for "running\\n" (trailing newline)', () => {
		expect(parseInspectStatus('running\n')).toBe('running');
	});

	it('returns "missing" for empty string', () => {
		expect(parseInspectStatus('')).toBe('missing');
	});

	it('returns "missing" for docker error output', () => {
		expect(parseInspectStatus('Error: No such object: foo')).toBe('missing');
	});

	it('returns "stopped" for "exited"', () => {
		expect(parseInspectStatus('exited')).toBe('stopped');
	});

	it('returns "stopped" for "created"', () => {
		expect(parseInspectStatus('created')).toBe('stopped');
	});

	it('returns "stopped" for "paused"', () => {
		expect(parseInspectStatus('paused')).toBe('stopped');
	});
});

describe('getContainerState', () => {
	beforeEach(() => mockExecSync.mockReset());

	it('returns "running" when docker inspect outputs "running"', () => {
		mockExecSync.mockReturnValueOnce('running\n');
		expect(getContainerState()).toBe('running');
	});

	it('returns "missing" when execSync throws', () => {
		mockExecSync.mockImplementationOnce(() => { throw new Error('No such object'); });
		expect(getContainerState()).toBe('missing');
	});

	it('returns "stopped" for exited container', () => {
		mockExecSync.mockReturnValueOnce('exited\n');
		expect(getContainerState()).toBe('stopped');
	});
});

describe('ensureContainerRunning', () => {
	beforeEach(() => mockExecSync.mockReset());

	it('does nothing when container is already running', () => {
		mockExecSync.mockReturnValueOnce('running\n'); // getContainerState inspect call
		ensureContainerRunning();
		expect(mockExecSync).toHaveBeenCalledTimes(1);
	});

	it('calls docker start when container is stopped', () => {
		mockExecSync
			.mockReturnValueOnce('exited\n') // getContainerState
			.mockReturnValueOnce('');         // docker start
		ensureContainerRunning();
		expect(mockExecSync).toHaveBeenCalledTimes(2);
		expect(mockExecSync.mock.calls[1][0]).toMatch(/docker start/);
	});

	it('calls docker run when container is missing', () => {
		mockExecSync
			.mockImplementationOnce(() => { throw new Error(); }) // getContainerState → missing
			.mockReturnValueOnce('');                              // docker run
		ensureContainerRunning();
		expect(mockExecSync).toHaveBeenCalledTimes(2);
		expect(mockExecSync.mock.calls[1][0]).toMatch(/docker run/);
	});
});

describe('stopContainer', () => {
	beforeEach(() => mockExecSync.mockReset());

	it('calls docker stop', () => {
		mockExecSync.mockReturnValueOnce('');
		stopContainer();
		expect(mockExecSync.mock.calls[0][0]).toMatch(/docker stop/);
	});

	it('does not throw when docker stop fails (already stopped)', () => {
		mockExecSync.mockImplementationOnce(() => { throw new Error('already stopped'); });
		expect(() => stopContainer()).not.toThrow();
	});
});
