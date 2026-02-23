/**
 * Debug endpoint — returns the server-side debug log ring buffer.
 * Protected by the same session auth as all other endpoints (via hooks.server.ts).
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
