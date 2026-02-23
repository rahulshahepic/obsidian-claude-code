/**
 * Issues a short-lived WebSocket authentication ticket.
 *
 * Called by the client before opening a WebSocket connection so that it has a
 * token it can pass as ?token=<ticket> in the WebSocket URL.  This allows
 * WebSocket auth to succeed in environments (iOS Safari, Android WebView, PWA)
 * where the session cookie is not reliably sent with upgrade requests.
 *
 * The endpoint is protected by the standard auth hook — only authenticated
 * sessions can obtain a ticket.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createWsTicket } from '$lib/server/ws-ticket.js';

export const GET: RequestHandler = () => {
	return json({ ticket: createWsTicket() });
};
