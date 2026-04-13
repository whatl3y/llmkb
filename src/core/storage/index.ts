import path from 'path';
import config from '../../config.js';
import type { StorageBackend } from './types.js';

export type { StorageBackend, HashEntry } from './types.js';

/**
 * Create the appropriate storage backend based on STORAGE_BACKEND env var.
 *
 * - "filesystem" (default): all data in local DATA_DIR/
 * - "database": wiki pages + metadata in Postgres, uploads in S3
 */
export async function createStorageBackend(): Promise<StorageBackend> {
  if (config.storage.backend === 'database') {
    const { DatabaseStorage } = await import('./database.js');
    return new DatabaseStorage();
  }

  const dataDir = path.resolve(config.storage.dataDir);
  const { FileSystemStorage } = await import('./filesystem.js');
  return new FileSystemStorage(dataDir);
}
