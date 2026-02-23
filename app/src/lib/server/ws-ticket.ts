/**
 * Short-lived WebSocket authentication tickets.
 *
 * In some environments (iOS Safari, Android WebView, certain PWA contexts)
 * the browser does not send cookies with WebSocket upgrade requests.  Tickets
 * provide an alternative: the client fetches a ticket via an authenticated
 * HTTP request to GET /api/ws-ticket, then passes it as ?token=<ticket> in
 * the WebSocket URL.
 *
 * A ticket is valid for TICKET_TTL_MS milliseconds (default: 30 s) and is
 * HMAC-signed with APP_SECRET so it cannot be forged.  It is stateless —
 * no server-side storage is needed.
 *
 * Format: <timestamp_base36>.<nonce_base64url>.<hmac_base64url>
 */
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/** Tickets expire after 30 seconds — long enough for the WS handshake. */
const TICKET_TTL_MS = 30_000;

function getSecret(): string {
	return process.env.APP_SECRET ?? '';
}

/** Create a signed, time-limited WebSocket auth ticket. */
export function createWsTicket(): string {
	const ts = Date.now().toString(36);
	const nonce = randomBytes(8).toString('base64url');
	const payload = `${ts}.${nonce}`;
	const secret = getSecret();
	const mac = createHmac('sha256', secret).update(payload).digest('base64url');
	return `${payload}.${mac}`;
}

/**
 * Returns true if the ticket is well-formed, HMAC-valid, and not expired.
 * Returns false for any invalid input without throwing.
 */
export function isValidWsTicket(ticket: string): boolean {
	const secret = getSecret();
	if (!secret || secret.length < 32) return false;

	const lastDot = ticket.lastIndexOf('.');
	if (lastDot === -1) return false;

	const payload = ticket.slice(0, lastDot);
	const mac = createHmac('sha256', secret).update(payload).digest('base64url');
	const expected = `${payload}.${mac}`;

	try {
		if (!timingSafeEqual(Buffer.from(ticket), Buffer.from(expected))) return false;
	} catch {
		// Buffers differ in length → not equal
		return false;
	}

	// Verify the timestamp is recent
	const firstDot = payload.indexOf('.');
	if (firstDot === -1) return false;
	const ts = parseInt(payload.slice(0, firstDot), 36);
	if (isNaN(ts)) return false;
	return Date.now() - ts < TICKET_TTL_MS;
}
