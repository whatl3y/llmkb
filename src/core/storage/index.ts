import path from 'path';
import config from '../../config.js';
import { DatabaseStorage } from './database.js';
import { FileSystemStorage } from './filesystem.js';
import type { StorageBackend } from './types.js';

export type { StorageBackend, HashEntry } from './types.js';

/**
 * Create the appropriate storage backend based on STORAGE_BACKEND env var.
 *
 * - "filesystem" (default): all data in local DATA_DIR/
 * - "database": wiki pages + metadata in Postgres, uploads in S3
 */
export function createStorageBackend(): StorageBackend {
  if (config.storage.backend === 'database') {
    return new DatabaseStorage();
  }

  const dataDir = path.resolve(config.storage.dataDir);
  return new FileSystemStorage(dataDir);
}
