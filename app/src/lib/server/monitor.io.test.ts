/**
 * Tests for monitor.ts IO-bound functions and snapshot builders.
 * Uses vi.hoisted + vi.mock to stub fs, child_process, and the DB module
 * so no real filesystem reads or process execution occurs.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoist mock functions so they're available inside vi.mock factory closures
// ---------------------------------------------------------------------------
const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockExecSync = vi.hoisted(() => vi.fn());
const mockGetConfig = vi.hoisted(() => vi.fn());
const mockDbGetAll = vi.hoisted(() => vi.fn());
const mockDbGetRecent = vi.hoisted(() => vi.fn());

vi.mock('fs', () => ({ readFileSync: mockReadFileSync }));
vi.mock('child_process', () => ({ execSync: mockExecSync }));

// Mock the entire db module — avoids running real migrations in this suite
vi.mock('./db/index.js', () => ({
	getConfig: mockGetConfig,
	setConfig: vi.fn(),
	deleteConfig: vi.fn(),
	db: {
		select: vi.fn(() => ({
			from: vi.fn(() => ({
				// First call (.get() with no where) → totals
				get: mockDbGetAll,
				// Second call (chained .where().get()) → recent
				where: vi.fn(() => ({ get: mockDbGetRecent }))
			}))
		}))
	}
}));

import { getHealthSnapshot, getMonitorSnapshot } from './monitor.js';

// ---------------------------------------------------------------------------
// Shared setup — a healthy system by default
// ---------------------------------------------------------------------------

const FUTURE = new Date(Date.now() + 7_200_000).toISOString(); // 2h from now
const PAST = new Date(Date.now() - 1_000).toISOString(); // 1s ago (expired)

const PROC_STAT_LINE = 'cpu  100 20 30 800 10 0 5 0 0 0\n';
const PROC_MEMINFO = 'MemTotal: 16384000 kB\nMemAvailable: 8192000 kB\n';
const DF_LINE = '/dev/sda1  107374182400  53687091200  53687091200  50% /\n';
const CONTAINER_RUNNING = `running ${new Date(Date.now() - 3_600_000).toISOString()}`;

function setupHealthyMocks() {
	mockReadFileSync.mockImplementation((path: string) => {
		if (path === '/proc/stat') return PROC_STAT_LINE;
		if (path === '/proc/meminfo') return PROC_MEMINFO;
		throw new Error(`Unexpected readFileSync: ${path}`);
	});

	mockExecSync.mockImplementation((cmd: string) => {
		if (cmd.includes('docker inspect')) return CONTAINER_RUNNING;
		if (cmd.includes('df')) return DF_LINE;
		throw new Error(`Unexpected execSync: ${cmd}`);
	});

	mockGetConfig.mockImplementation((key: string) => {
		if (key === 'setup_complete') return 'true';
		if (key === 'claude_token_expires_at') return FUTURE;
		return null;
	});

	mockDbGetAll.mockReturnValue({ count: 10, cost: 25.5 });
	mockDbGetRecent.mockReturnValue({ count: 3, cost: 8.75 });
}

beforeEach(() => {
	vi.clearAllMocks();
	setupHealthyMocks();
});

// ---------------------------------------------------------------------------
// getHealthSnapshot
// ---------------------------------------------------------------------------

describe('getHealthSnapshot', () => {
	it('returns ok when container is running and token is valid', async () => {
		const snap = await getHealthSnapshot();
		expect(snap.status).toBe('ok');
		expect(snap.setupComplete).toBe(true);
		expect(snap.containerStatus).toBe('running');
		expect(snap.claudeTokenValid).toBe(true);
		expect(snap.claudeTokenExpiresInSeconds).toBeGreaterThan(7000);
		expect(snap.version).toBe('0.1.0');
		expect(snap.uptimeSeconds).toBeGreaterThanOrEqual(0);
	});

	it('returns degraded when setup is not complete', async () => {
		mockGetConfig.mockImplementation((key: string) => {
			if (key === 'setup_complete') return null;
			if (key === 'claude_token_expires_at') return FUTURE;
			return null;
		});
		const snap = await getHealthSnapshot();
		expect(snap.status).toBe('degraded');
		expect(snap.setupComplete).toBe(false);
	});

	it('returns degraded when container is missing (docker throws)', async () => {
		mockExecSync.mockImplementation((cmd: string) => {
			if (cmd.includes('docker inspect')) throw new Error('No such container');
			if (cmd.includes('df')) return DF_LINE;
			return '';
		});
		const snap = await getHealthSnapshot();
		expect(snap.status).toBe('degraded');
		expect(snap.containerStatus).toBe('missing');
	});

	it('returns degraded when container is stopped', async () => {
		mockExecSync.mockImplementation((cmd: string) => {
			if (cmd.includes('docker inspect')) return 'exited 2024-01-01T00:00:00Z';
			if (cmd.includes('df')) return DF_LINE;
			return '';
		});
		const snap = await getHealthSnapshot();
		expect(snap.status).toBe('degraded');
		expect(snap.containerStatus).toBe('stopped');
	});

	it('returns degraded when token is expired', async () => {
		mockGetConfig.mockImplementation((key: string) => {
			if (key === 'setup_complete') return 'true';
			if (key === 'claude_token_expires_at') return PAST;
			return null;
		});
		const snap = await getHealthSnapshot();
		expect(snap.status).toBe('degraded');
		expect(snap.claudeTokenValid).toBe(false);
		expect(snap.claudeTokenExpiresInSeconds).toBe(0);
	});

	it('returns degraded when token is absent', async () => {
		mockGetConfig.mockImplementation((key: string) => {
			if (key === 'setup_complete') return 'true';
			if (key === 'claude_token_expires_at') return null;
			return null;
		});
		const snap = await getHealthSnapshot();
		expect(snap.status).toBe('degraded');
		expect(snap.claudeTokenValid).toBe(false);
	});

});

// ---------------------------------------------------------------------------
// getMonitorSnapshot
// ---------------------------------------------------------------------------

describe('getMonitorSnapshot', () => {
	it('includes all fields from health + system + usage', async () => {
		const snap = await getMonitorSnapshot();

		// inherits from health
		expect(snap.status).toBe('ok');
		expect(snap.setupComplete).toBe(true);

		// system
		expect(typeof snap.cpu).toBe('number');
		expect(snap.cpu).toBeGreaterThanOrEqual(0);
		expect(snap.cpu).toBeLessThanOrEqual(100);
		expect(snap.mem.totalMb).toBeGreaterThan(0);
		expect(snap.mem.availableMb).toBeGreaterThan(0);
		expect(snap.mem.usedPercent).toBeGreaterThanOrEqual(0);
		expect(snap.disk.totalGb).toBeGreaterThan(0);
		expect(snap.disk.usedPercent).toBe(50);

		// container
		expect(snap.container.status).toBe('running');
		expect(snap.container.uptimeSeconds).toBeGreaterThan(0);

		// usage from mocked DB
		expect(snap.usage.totalSessions).toBe(10);
		expect(snap.usage.totalCostUsd).toBe(25.5);
		expect(snap.usage.last30DaysSessions).toBe(3);
		expect(snap.usage.last30DaysCostUsd).toBe(8.75);
	});

	it('handles null DB results gracefully', async () => {
		mockDbGetAll.mockReturnValue(null);
		mockDbGetRecent.mockReturnValue(null);
		const snap = await getMonitorSnapshot();
		expect(snap.usage.totalSessions).toBe(0);
		expect(snap.usage.totalCostUsd).toBe(0);
	});

	it('handles getDiskStats failure gracefully', async () => {
		mockExecSync.mockImplementation((cmd: string) => {
			if (cmd.includes('df')) throw new Error('df failed');
			if (cmd.includes('docker inspect')) return CONTAINER_RUNNING;
			return '';
		});
		const snap = await getMonitorSnapshot();
		expect(snap.disk.totalGb).toBe(0);
		expect(snap.disk.usedPercent).toBe(0);
	});
});
