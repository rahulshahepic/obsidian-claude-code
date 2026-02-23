/**
 * Observability endpoint — returns the server-side log ring buffer.
 *
 * GET  /api/debug  → { entries: DebugEntry[] }
 * DELETE /api/debug → clears the ring buffer
 *
 * Protected by the same session auth as all other endpoints (via hooks.server.ts).
 * The client-side debug panel polls this every 2 seconds when open.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDebugLog, clearDebugLog } from '$lib/server/debug-logger.js';

export const GET: RequestHandler = () => {
	return json({ entries: getDebugLog() });
};

export const DELETE: RequestHandler = () => {
	clearDebugLog();
	return json({ ok: true });
};
