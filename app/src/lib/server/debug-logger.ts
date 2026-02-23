/**
 * Structured debug logger for diagnosing WebSocket / auth connection issues.
 *
 * All entries go to stdout with a [DEBUG] prefix and ISO timestamp so they
 * are visible in Docker logs, journalctl, or whatever log aggregator is
 * attached.  The last N entries are also kept in a ring buffer that is
 * exposed via the /api/debug endpoint so you can inspect them from the
 * browser without SSH access.
 */

const RING_SIZE = 200;

export interface DebugEntry {
	ts: string;
	tag: string;
	msg: string;
	data?: Record<string, unknown>;
}

const ring: DebugEntry[] = [];

export function debug(tag: string, msg: string, data?: Record<string, unknown>): void {
	const ts = new Date().toISOString();
	const entry: DebugEntry = { ts, tag, msg, ...(data ? { data } : {}) };
	ring.push(entry);
	if (ring.length > RING_SIZE) ring.shift();

	// Also log to stdout for server-side visibility
	const extra = data ? ' ' + JSON.stringify(data) : '';
	console.log(`[DEBUG ${ts}] [${tag}] ${msg}${extra}`);
}

/** Return the last N debug entries (newest last). */
export function getDebugLog(limit = RING_SIZE): DebugEntry[] {
	return ring.slice(-limit);
}

/** Clear the debug ring buffer. */
export function clearDebugLog(): void {
	ring.length = 0;
}
