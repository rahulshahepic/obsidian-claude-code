import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { destroySession } from '$lib/server/auth/session.js';

export const POST: RequestHandler = async ({ cookies }) => {
	destroySession(cookies);
	throw redirect(302, '/login');
};
