/**
 * Session REST API.
 *
 * GET  /api/session  — current session state + cost
 * DELETE /api/session — interrupt the active session
 *
 * Both require auth (enforced by hooks.server.ts).
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { sessionManager } from '$lib/server/session-manager.js';

export const GET: RequestHandler = () => {
	return json({
		state: sessionManager.getState(),
	});
};

export const DELETE: RequestHandler = async () => {
	await sessionManager.interrupt();
	return json({ ok: true });
};
