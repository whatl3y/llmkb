import { Database } from './types.js';
import { Pool, PoolConfig } from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import config from '../config.js';

function isLocalOrDockerHost(host: string): boolean {
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
    return true;
  }
  if (!host.includes('.')) {
    return true;
  }
  const ipParts = host.split('.').map(Number);
  if (ipParts.length === 4 && ipParts.every((p) => !isNaN(p) && p >= 0 && p <= 255)) {
    if (ipParts[0] === 10) return true;
    if (ipParts[0] === 172 && ipParts[1] >= 16 && ipParts[1] <= 31) return true;
    if (ipParts[0] === 192 && ipParts[1] === 168) return true;
  }
  return false;
}

export function getPoolConfig(connectionString: string): PoolConfig {
  const poolConfig: PoolConfig = { connectionString };

  const url = new URL(connectionString);
  const sslmode = url.searchParams.get('sslmode');

  if (sslmode === 'disable') {
    poolConfig.ssl = false;
  } else if (sslmode) {
    poolConfig.ssl = { rejectUnauthorized: false };
  } else {
    if (isLocalOrDockerHost(url.hostname)) {
      poolConfig.ssl = false;
    } else {
      poolConfig.ssl = { rejectUnauthorized: false };
    }
  }

  return poolConfig;
}

let _db: Kysely<Database> | null = null;

function getDb(): Kysely<Database> {
  if (!_db) {
    if (!config.postgres.url) {
      throw new Error('DATABASE_URL environment variable is required');
    }
    const pool = new Pool(getPoolConfig(config.postgres.url));
    pool.on('error', (err) => {
      console.error('[db] Unexpected error on idle database client:', err.message);
    });
    const dialect = new PostgresDialect({ pool });
    _db = new Kysely<Database>({ dialect });
  }
  return _db;
}

export const db: Kysely<Database> = new Proxy({} as Kysely<Database>, {
  get(_target, prop) {
    const instance = getDb();
    const value = (instance as any)[prop];
    if (typeof value === 'function') {
      return value.bind(instance);
    }
    return value;
  },
});
