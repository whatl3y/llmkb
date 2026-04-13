import 'dotenv/config';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { Pool } from 'pg';
import { Kysely, Migrator, PostgresDialect, FileMigrationProvider } from 'kysely';
import type { Database } from './types.js';
import { getPoolConfig } from './database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function migrateToLatest(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const db = new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: new Pool(getPoolConfig(databaseUrl)),
    }),
  });

  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: path.join(__dirname, 'migrations'),
    }),
  });

  console.log('[migrate] Running database migrations...');

  const { error, results } = await migrator.migrateToLatest();

  results?.forEach((it) => {
    if (it.status === 'Success') {
      console.log(`[migrate] ✓ ${it.migrationName}`);
    } else if (it.status === 'Error') {
      console.error(`[migrate] ✗ ${it.migrationName}`);
    }
  });

  if (error) {
    console.error('[migrate] Migration failed:', error);
    await db.destroy();
    process.exit(1);
  }

  if (!results?.length) {
    console.log('[migrate] No pending migrations.');
  }

  await db.destroy();
  console.log('[migrate] Done.');
}

migrateToLatest();
