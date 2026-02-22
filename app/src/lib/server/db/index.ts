import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import * as schema from './schema.js';

const DB_PATH = process.env.DATABASE_URL ?? './data/app.db';

// Ensure the data directory exists before opening the DB file.
mkdirSync(dirname(DB_PATH), { recursive: true });

const sqlite = new Database(DB_PATH);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });

// Run migrations on startup (idempotent).
migrate(db, { migrationsFolder: './drizzle' });

// Typed helpers for the config table ----------------------------------------

export function getConfig(key: string): string | null {
	const row = db.select().from(schema.config).where(eq(schema.config.key, key)).get();
	return row?.value ?? null;
}

export function setConfig(key: string, value: string): void {
	db.insert(schema.config)
		.values({ key, value })
		.onConflictDoUpdate({ target: schema.config.key, set: { value } })
		.run();
}

export function deleteConfig(key: string): void {
	db.delete(schema.config).where(eq(schema.config.key, key)).run();
}
