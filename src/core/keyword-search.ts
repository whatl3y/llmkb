import type { SearchResult } from '../types/index.js';
import type { StorageBackend } from './storage/types.js';

const WIKI_SUBDIRS = ['concepts', 'entities', 'sources', 'syntheses'] as const;

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'has',
  'her', 'was', 'one', 'our', 'out', 'how', 'what', 'who', 'which',
  'their', 'there', 'about', 'would', 'this', 'that', 'with', 'from',
  'have', 'been', 'does', 'will', 'each', 'make', 'like', 'into',
  'than', 'them', 'then', 'could', 'other', 'more', 'some', 'when',
  'where', 'most', 'tell',
]);

/**
 * Extract meaningful keywords from a query (3+ chars, not stop words).
 * For longer words (5+ chars), also generates a shorter prefix stem
 * so that e.g. "lucera" matches "luceris" via the shared prefix "lucer".
 */
export function extractKeywords(query: string): string[] {
  const words = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));

  const keywords: string[] = [];
  for (const w of words) {
    keywords.push(w);
    // Add a prefix stem (drop last 1-2 chars) for fuzzy matching on proper nouns.
    // Only for words 5+ chars so short words aren't over-broadened.
    if (w.length >= 5) {
      const stem = w.slice(0, -1);
      if (!keywords.includes(stem)) keywords.push(stem);
    }
  }
  return keywords;
}

/**
 * Scan wiki pages via the storage backend for keyword matches.
 * Returns pages whose slug or content contains any keyword.
 */
export async function keywordSearch(
  storage: StorageBackend,
  keywords: string[]
): Promise<SearchResult[]> {
  if (keywords.length === 0) return [];

  const results: SearchResult[] = [];

  for (const subdir of WIKI_SUBDIRS) {
    const pages = await storage.listPagesWithContent(subdir);

    for (const { slug, raw } of pages) {
      const lowerContent = raw.toLowerCase();
      const lowerSlug = slug.toLowerCase();

      // Score: how many keywords match in filename or content
      let score = 0;
      for (const kw of keywords) {
        if (lowerSlug.includes(kw)) score += 2; // filename match weighted higher
        if (lowerContent.includes(kw)) score += 1;
      }

      if (score > 0) {
        results.push({
          page: `wiki/${subdir}/${slug}.md`,
          slug,
          excerpt: raw.slice(0, 200),
          score,
        });
      }
    }
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);
  return results;
}

/**
 * Merge vector search results with keyword search results, deduplicating by slug.
 * Keyword matches come first (more precise for proper nouns).
 */
export function mergeResults(
  keywordResults: SearchResult[],
  vectorResults: SearchResult[],
  limit: number
): SearchResult[] {
  const seen = new Set<string>();
  const merged: SearchResult[] = [];

  for (const r of keywordResults) {
    if (!seen.has(r.slug)) {
      seen.add(r.slug);
      merged.push(r);
    }
  }
  for (const r of vectorResults) {
    if (!seen.has(r.slug)) {
      seen.add(r.slug);
      merged.push(r);
    }
  }

  return merged.slice(0, limit);
}
