/**
 * In-app observability logger.
 *
 * This is a permanent part of the app's infrastructure — not temporary
 * diagnostic code. Because this project is mobile-only (no desktop, no SSH),
 * all observability must be accessible from the browser UI.
 *
 * Every call to debug() does two things:
 *   1. Writes to stdout (visible in Docker logs / journalctl if you happen
 *      to have server access).
 *   2. Appends to an in-memory ring buffer (last 200 entries) that is
 *      exposed via GET /api/debug and rendered in the client-side debug
 *      panel (toggled from the header).
 *
 * Tags are short identifiers for the subsystem:
 *   ws-server, ws-auth, ws-handler, session-mgr, oauth, hooks
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
