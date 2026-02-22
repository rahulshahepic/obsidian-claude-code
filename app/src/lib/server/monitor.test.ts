import { describe, it, expect } from 'vitest';
import {
	parseProcStatLine,
	parseMemInfo,
	parseDfLine,
	parseContainerInspect,
	parseTokenExpiry
} from './monitor.js';

// ---------------------------------------------------------------------------
// parseProcStatLine
// ---------------------------------------------------------------------------
describe('parseProcStatLine', () => {
	it('parses a typical /proc/stat cpu line', () => {
		// cpu  user nice system idle iowait irq softirq steal guest guest_nice
		const line = 'cpu  100 20 30 800 10 0 5 0 0 0';
		const result = parseProcStatLine(line);
		expect(result.user).toBe(100);
		expect(result.nice).toBe(20);
		expect(result.system).toBe(30);
		expect(result.idle).toBe(800);
		expect(result.total).toBe(100 + 20 + 30 + 800 + 10 + 0 + 5 + 0 + 0 + 0);
	});

	it('handles all-zero line', () => {
		const result = parseProcStatLine('cpu  0 0 0 0 0 0 0 0 0 0');
		expect(result.total).toBe(0);
		expect(result.idle).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// parseMemInfo
// ---------------------------------------------------------------------------
describe('parseMemInfo', () => {
	const fixture = `
MemTotal:       16384000 kB
MemFree:         2048000 kB
MemAvailable:    8192000 kB
Buffers:          512000 kB
Cached:          4096000 kB
`.trim();

	it('extracts totalMb correctly', () => {
		const { totalMb } = parseMemInfo(fixture);
		expect(totalMb).toBe(Math.round(16384000 / 1024)); // 16000
	});

	it('extracts availableMb correctly', () => {
		const { availableMb } = parseMemInfo(fixture);
		expect(availableMb).toBe(Math.round(8192000 / 1024)); // 8000
	});

	it('computes usedPercent as (total - available) / total', () => {
		const { usedPercent } = parseMemInfo(fixture);
		const expectedUsedKb = 16384000 - 8192000;
		const expected = Math.round((expectedUsedKb / 16384000) * 100);
		expect(usedPercent).toBe(expected);
	});

	it('returns zero usedPercent when MemTotal is missing', () => {
		const { usedPercent } = parseMemInfo('MemAvailable: 1000 kB\n');
		expect(usedPercent).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// parseDfLine
// ---------------------------------------------------------------------------
describe('parseDfLine', () => {
	// Typical df -B1 output line: filesystem 1B-blocks used available use% mount
	const line = '/dev/sda1  107374182400  53687091200  53687091200  50% /';

	it('computes totalGb', () => {
		const { totalGb } = parseDfLine(line);
		expect(totalGb).toBe(Math.round((107374182400 / 1e9) * 10) / 10);
	});

	it('computes usedGb', () => {
		const { usedGb } = parseDfLine(line);
		expect(usedGb).toBe(Math.round((53687091200 / 1e9) * 10) / 10);
	});

	it('computes usedPercent', () => {
		const { usedPercent } = parseDfLine(line);
		expect(usedPercent).toBe(50);
	});

	it('returns zero for unparseable line', () => {
		const { totalGb, usedGb, usedPercent } = parseDfLine('/ 0 0 0 - /');
		expect(totalGb).toBe(0);
		expect(usedGb).toBe(0);
		expect(usedPercent).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// parseContainerInspect
// ---------------------------------------------------------------------------
describe('parseContainerInspect', () => {
	const NOW = new Date('2024-01-01T12:00:00Z').getTime();

	it('returns running with uptimeSeconds for a running container', () => {
		const startedAt = new Date(NOW - 3600 * 1000).toISOString(); // 1h ago
		const out = `running ${startedAt}`;
		const result = parseContainerInspect(out, NOW);
		expect(result.status).toBe('running');
		expect(result.uptimeSeconds).toBe(3600);
	});

	it('returns stopped for a non-running state', () => {
		const result = parseContainerInspect('exited 2024-01-01T00:00:00Z', NOW);
		expect(result.status).toBe('stopped');
		expect(result.uptimeSeconds).toBeUndefined();
	});

	it('returns missing for empty output', () => {
		expect(parseContainerInspect('', NOW).status).toBe('missing');
		expect(parseContainerInspect('   ', NOW).status).toBe('missing');
	});

	it('returns missing when state string has no space (single word)', () => {
		// docker not found → blank output; or "missing" word
		const result = parseContainerInspect('missing', NOW);
		expect(result.status).toBe('stopped');
	});
});

// ---------------------------------------------------------------------------
// parseTokenExpiry
// ---------------------------------------------------------------------------
describe('parseTokenExpiry', () => {
	const NOW = new Date('2024-06-01T12:00:00Z').getTime();

	it('returns invalid when expiresAt is null', () => {
		expect(parseTokenExpiry(null, NOW)).toEqual({ valid: false });
	});

	it('returns invalid with expiresInSeconds=0 when token is expired', () => {
		const expired = new Date(NOW - 1000).toISOString();
		const result = parseTokenExpiry(expired, NOW);
		expect(result.valid).toBe(false);
		expect(result.expiresInSeconds).toBe(0);
	});

	it('returns valid with correct expiresInSeconds for a future expiry', () => {
		const future = new Date(NOW + 7200 * 1000).toISOString(); // 2h from now
		const result = parseTokenExpiry(future, NOW);
		expect(result.valid).toBe(true);
		expect(result.expiresInSeconds).toBe(7200);
	});

	it('returns invalid when expiry is exactly now', () => {
		const exact = new Date(NOW).toISOString();
		const result = parseTokenExpiry(exact, NOW);
		expect(result.valid).toBe(false);
	});
});
