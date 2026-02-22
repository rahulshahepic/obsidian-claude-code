import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

/**
 * Key-value config store. Sensitive values (tokens, credentials) are
 * encrypted with AES-256-GCM before insertion; the db layer never sees
 * plaintext for those keys.
 *
 * Known keys:
 *   setup_complete          "true" | undefined
 *   webauthn_credential     JSON (id, publicKey, counter, transports)
 *   claude_oauth_token      encrypted — CLAUDE_CODE_OAUTH_TOKEN
 *   claude_refresh_token    encrypted — used to get new access tokens
 *   claude_token_expires_at ISO timestamp string
 *   vault_path              absolute path to the vault directory on host
 *   vault_git_remote        remote URL shown to Obsidian Git plugin
 */
export const config = sqliteTable('config', {
	key: text('key').primaryKey(),
	value: text('value').notNull()
});

/**
 * Session history — one row per Claude Code session.
 */
export const sessions = sqliteTable('sessions', {
	id: text('id').primaryKey(), // uuid
	startedAt: integer('started_at', { mode: 'timestamp' }).notNull(),
	endedAt: integer('ended_at', { mode: 'timestamp' }),
	status: text('status').notNull().default('running'), // 'running' | 'stopped' | 'error'
	turnCount: integer('turn_count').notNull().default(0),
	costUsd: real('cost_usd').notNull().default(0)
});
