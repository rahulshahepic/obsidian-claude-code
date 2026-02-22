/**
 * System health and usage statistics.
 * Reads from /proc (Linux), Docker socket, and the local DB.
 */
import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import { db } from './db/index.js';
import { sessions } from './db/schema.js';
import { getConfig } from './db/index.js';
import { sql, gte } from 'drizzle-orm';

const PROCESS_START = Date.now();

// ---------------------------------------------------------------------------
// Host system stats (Linux /proc)
// ---------------------------------------------------------------------------

interface CpuStats {
	user: number;
	nice: number;
	system: number;
	idle: number;
	total: number;
}

function readCpuStats(): CpuStats {
	const line = readFileSync('/proc/stat', 'utf8').split('\n')[0];
	const parts = line.split(/\s+/).slice(1).map(Number);
	const [user, nice, system, idle] = parts;
	return { user, nice, system, idle, total: parts.reduce((a, b) => a + b, 0) };
}

// Two samples ~100ms apart for a meaningful CPU% reading
async function getCpuPercent(): Promise<number> {
	const s1 = readCpuStats();
	await new Promise((r) => setTimeout(r, 150));
	const s2 = readCpuStats();
	const totalDiff = s2.total - s1.total;
	const idleDiff = s2.idle - s1.idle;
	if (totalDiff === 0) return 0;
	return Math.round(((totalDiff - idleDiff) / totalDiff) * 100);
}

interface MemStats {
	totalMb: number;
	availableMb: number;
	usedPercent: number;
}

function getMemStats(): MemStats {
	const raw = readFileSync('/proc/meminfo', 'utf8');
	const get = (key: string) => {
		const match = raw.match(new RegExp(`^${key}:\\s+(\\d+)`, 'm'));
		return match ? parseInt(match[1]) : 0;
	};
	const totalKb = get('MemTotal');
	const availableKb = get('MemAvailable');
	const usedKb = totalKb - availableKb;
	return {
		totalMb: Math.round(totalKb / 1024),
		availableMb: Math.round(availableKb / 1024),
		usedPercent: totalKb ? Math.round((usedKb / totalKb) * 100) : 0
	};
}

interface DiskStats {
	totalGb: number;
	usedGb: number;
	usedPercent: number;
}

function getDiskStats(path = '/'): DiskStats {
	try {
		const out = execSync(`df -B1 "${path}" | tail -1`, { encoding: 'utf8' });
		const parts = out.trim().split(/\s+/);
		const total = parseInt(parts[1]);
		const used = parseInt(parts[2]);
		return {
			totalGb: Math.round((total / 1e9) * 10) / 10,
			usedGb: Math.round((used / 1e9) * 10) / 10,
			usedPercent: total ? Math.round((used / total) * 100) : 0
		};
	} catch {
		return { totalGb: 0, usedGb: 0, usedPercent: 0 };
	}
}

// ---------------------------------------------------------------------------
// Docker container stats
// ---------------------------------------------------------------------------

interface ContainerStatus {
	status: 'running' | 'stopped' | 'missing';
	uptimeSeconds?: number;
}

function getContainerStatus(name = 'claude-workspace'): ContainerStatus {
	try {
		const out = execSync(`docker inspect --format '{{.State.Status}} {{.State.StartedAt}}' ${name} 2>/dev/null`, {
			encoding: 'utf8',
			timeout: 3000
		}).trim();
		if (!out) return { status: 'missing' };
		const [state, startedAt] = out.split(' ');
		if (state !== 'running') return { status: 'stopped' };
		const started = new Date(startedAt).getTime();
		return { status: 'running', uptimeSeconds: Math.floor((Date.now() - started) / 1000) };
	} catch {
		return { status: 'missing' };
	}
}

// ---------------------------------------------------------------------------
// Claude token status
// ---------------------------------------------------------------------------

interface TokenStatus {
	valid: boolean;
	expiresInSeconds?: number;
}

function getTokenStatus(): TokenStatus {
	const expiresAt = getConfig('claude_token_expires_at');
	if (!expiresAt) return { valid: false };
	const expiresMs = new Date(expiresAt).getTime();
	const nowMs = Date.now();
	if (expiresMs <= nowMs) return { valid: false, expiresInSeconds: 0 };
	return { valid: true, expiresInSeconds: Math.floor((expiresMs - nowMs) / 1000) };
}

// ---------------------------------------------------------------------------
// Usage aggregates
// ---------------------------------------------------------------------------

interface UsageStats {
	totalSessions: number;
	totalCostUsd: number;
	last30DaysSessions: number;
	last30DaysCostUsd: number;
}

function getUsageStats(): UsageStats {
	const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

	const all = db
		.select({
			count: sql<number>`count(*)`,
			cost: sql<number>`coalesce(sum(cost_usd), 0)`
		})
		.from(sessions)
		.get();

	const recent = db
		.select({
			count: sql<number>`count(*)`,
			cost: sql<number>`coalesce(sum(cost_usd), 0)`
		})
		.from(sessions)
		.where(gte(sessions.startedAt, thirtyDaysAgo))
		.get();

	return {
		totalSessions: all?.count ?? 0,
		totalCostUsd: Math.round((all?.cost ?? 0) * 100) / 100,
		last30DaysSessions: recent?.count ?? 0,
		last30DaysCostUsd: Math.round((recent?.cost ?? 0) * 100) / 100
	};
}

// ---------------------------------------------------------------------------
// Vault stats
// ---------------------------------------------------------------------------

interface VaultStats {
	lastPushAt: string | null;
	path: string | null;
}

function getVaultStats(): VaultStats {
	const vaultPath = getConfig('vault_path');
	if (!vaultPath) return { lastPushAt: null, path: null };

	let lastPushAt: string | null = null;
	try {
		const ts = execSync(`git -C "${vaultPath}" log -1 --format=%cI 2>/dev/null`, {
			encoding: 'utf8',
			timeout: 2000
		}).trim();
		if (ts) lastPushAt = ts;
	} catch {
		// git not initialised or no commits yet
	}

	return { lastPushAt, path: vaultPath };
}

// ---------------------------------------------------------------------------
// Public health snapshot
// ---------------------------------------------------------------------------

export interface HealthSnapshot {
	status: 'ok' | 'degraded';
	uptimeSeconds: number;
	setupComplete: boolean;
	containerStatus: ContainerStatus['status'];
	claudeTokenValid: boolean;
	claudeTokenExpiresInSeconds?: number;
	vaultLastPush: string | null;
	version: string;
}

export async function getHealthSnapshot(): Promise<HealthSnapshot> {
	const container = getContainerStatus();
	const token = getTokenStatus();
	const vault = getVaultStats();
	const setupComplete = getConfig('setup_complete') === 'true';

	const degraded =
		!setupComplete || container.status !== 'running' || !token.valid;

	return {
		status: degraded ? 'degraded' : 'ok',
		uptimeSeconds: Math.floor((Date.now() - PROCESS_START) / 1000),
		setupComplete,
		containerStatus: container.status,
		claudeTokenValid: token.valid,
		claudeTokenExpiresInSeconds: token.expiresInSeconds,
		vaultLastPush: vault.lastPushAt,
		version: '0.1.0'
	};
}

// ---------------------------------------------------------------------------
// Full monitor snapshot (authenticated page only)
// ---------------------------------------------------------------------------

export interface MonitorSnapshot extends HealthSnapshot {
	cpu: number;
	mem: MemStats;
	disk: DiskStats;
	container: ContainerStatus;
	usage: UsageStats;
	vault: VaultStats;
}

export async function getMonitorSnapshot(): Promise<MonitorSnapshot> {
	const [health, cpuPercent] = await Promise.all([getHealthSnapshot(), getCpuPercent()]);

	return {
		...health,
		cpu: cpuPercent,
		mem: getMemStats(),
		disk: getDiskStats(),
		container: getContainerStatus(),
		usage: getUsageStats(),
		vault: getVaultStats()
	};
}
