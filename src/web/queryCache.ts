/** Simple in-memory cache for query results with TTL. */

const TTL = 30 * 60 * 1000; // 30 minutes

interface CacheEntry {
  result: unknown;
  browseFilter: string;
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();

function normalizeKey(key: string): string {
  return key.trim().toLowerCase();
}

export function getCached(key: string): CacheEntry | null {
  const entry = cache.get(normalizeKey(key));
  if (!entry) return null;
  if (Date.now() - entry.timestamp > TTL) {
    cache.delete(normalizeKey(key));
    return null;
  }
  return entry;
}

export function setCached(key: string, result: unknown, browseFilter = 'all'): void {
  cache.set(normalizeKey(key), {
    result,
    browseFilter,
    timestamp: Date.now(),
  });
}
