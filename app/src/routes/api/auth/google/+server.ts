import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { generateAuthUrl } from '$lib/server/auth/google.js';

/** GET — redirect the browser to Google's OAuth consent screen. */
export const GET: RequestHandler = async () => {
	throw redirect(302, generateAuthUrl());
};
