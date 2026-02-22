import type { PageServerLoad } from './$types';
import { getMonitorSnapshot } from '$lib/server/monitor.js';

export const load: PageServerLoad = async () => {
	const snapshot = await getMonitorSnapshot();
	return { snapshot };
};
