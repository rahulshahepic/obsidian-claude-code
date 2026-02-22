import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getMonitorSnapshot } from '$lib/server/monitor.js';

/** Authenticated JSON endpoint used by the /monitor page for live refresh. */
export const GET: RequestHandler = async () => {
	const snapshot = await getMonitorSnapshot();
	return json(snapshot);
};
