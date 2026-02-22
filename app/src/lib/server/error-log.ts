/**
 * In-memory ring buffer for recent server errors.
 *
 * Written to by handleError in hooks.server.ts.
 * Read by monitor.ts (full history, auth-gated) and
 * health snapshot (last message only, public).
 *
 * Survives across requests within a single process lifetime;
 * cleared on container restart (intentional — stale errors are noise).
 */

export interface ErrorEntry {
	ts: number; // Unix ms
	message: string;
	stack?: string;
}

const MAX_ENTRIES = 30;
const buf: ErrorEntry[] = [];

/**
 * Scrub patterns that look like secrets from a string before storing.
 *
 * `error.stack` is usually just file paths + line numbers, but OAuth libraries
 * (e.g. google-auth-library) can embed HTTP response bodies in the message,
 * which may include access_token values.
 *
 * We do NOT try to enumerate every possible secret format; instead we remove
 * the most common opaque token shapes (Bearer/OAuth tokens, base64url strings
 * ≥32 chars that look like keys). This is best-effort, not a hard guarantee.
 */
function scrub(s: string): string {
	return s
		// Bearer / OAuth header values
		.replace(/\bBearer\s+[\w\-._~+/]+=*/gi, 'Bearer [redacted]')
		// JSON key/value pairs where the key looks like a token field
		.replace(/"(access_token|id_token|refresh_token|client_secret|token)"\s*:\s*"[^"]+"/gi,
			'"$1":"[redacted]"')
		// Bare base64url strings ≥ 40 chars (Google tokens are ~100 chars, JWTs are long)
		.replace(/\b(ey[A-Za-z0-9\-_]{40,})\b/g, '[jwt-redacted]')
		// ya29.* — Google OAuth access tokens
		.replace(/\bya29\.[A-Za-z0-9\-_.]{10,}/g, '[goog-token-redacted]');
}

export function pushError(message: string, stack?: string): void {
	buf.push({ ts: Date.now(), message: scrub(message), stack: stack ? scrub(stack) : undefined });
	if (buf.length > MAX_ENTRIES) buf.shift();
}

/** Most-recent first. */
export function getErrors(): ErrorEntry[] {
	return buf.slice().reverse();
}

export function getLastError(): ErrorEntry | null {
	return buf.length > 0 ? { ...buf[buf.length - 1] } : null;
}
