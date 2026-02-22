import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getHealthSnapshot } from '$lib/server/monitor.js';

/**
 * Unauthenticated health check endpoint.
 * Returns 200 when status is "ok", 503 when "degraded".
 * Suitable for UptimeRobot / Betterstack / any HTTP monitor.
 */
export const GET: RequestHandler = async () => {
	const snapshot = await getHealthSnapshot();
	return json(snapshot, { status: snapshot.status === 'ok' ? 200 : 503 });
};
