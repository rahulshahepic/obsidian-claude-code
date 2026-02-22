/**
 * Global test setup — sets required environment variables before any test module loads.
 * These mirror what .env provides in production.
 */

// 64-char hex key for AES-256-GCM (test-only, never used in production)
process.env.ENCRYPTION_KEY = 'a'.repeat(64);

// Session signing secret
process.env.APP_SECRET = 'test-secret-that-is-long-enough-for-hmac-signing-purposes';

// SQLite in a temp file (overridden per-suite when needed)
process.env.DATABASE_URL = '/tmp/test-app.db';

// WebAuthn origin (unused in unit tests but avoids import errors)
process.env.PUBLIC_URL = 'http://localhost:5173';
