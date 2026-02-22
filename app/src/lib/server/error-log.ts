/**
 * In-memory ring buffer for recent server errors.
 *
 * Written to by handleError in hooks.server.ts.
 * Read by monitor.ts (full history, auth-gated) and
 * health snapshot (last message only, public).
 *
 * Survives across requests within a single process lifetime;
 * cleared on container restart (intentional — stale errors are noise).
 */

export interface ErrorEntry {
	ts: number; // Unix ms
	message: string;
	stack?: string;
}

const MAX_ENTRIES = 30;
const buf: ErrorEntry[] = [];

export function pushError(message: string, stack?: string): void {
	buf.push({ ts: Date.now(), message, stack });
	if (buf.length > MAX_ENTRIES) buf.shift();
}

/** Most-recent first. */
export function getErrors(): ErrorEntry[] {
	return buf.slice().reverse();
}

export function getLastError(): ErrorEntry | null {
	return buf.length > 0 ? { ...buf[buf.length - 1] } : null;
}
