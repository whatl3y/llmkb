import { Router } from 'express';
import { SearchService } from '../../core/search.js';
import { extractKeywords, keywordSearch, mergeResults } from '../../core/keyword-search.js';
import type { StorageBackend } from '../../core/storage/types.js';

export function createSearchRouter(searchService: SearchService, storage: StorageBackend): Router {
  const router = Router();

  /**
   * POST /api/search — combined semantic + keyword search across the wiki
   */
  router.post('/', async (req, res, next) => {
    try {
      const { query, limit } = req.body;
      if (!query || typeof query !== 'string') {
        res.status(400).json({ success: false, error: 'query is required' });
        return;
      }

      const cap = limit ?? 10;
      const keywords = extractKeywords(query);

      const [vectorResults, kwResults] = await Promise.all([
        searchService.search(query, cap).catch(() => []),
        keywordSearch(storage, keywords),
      ]);

      const results = mergeResults(kwResults, vectorResults, cap);
      res.json({ success: true, data: results });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/search/reindex — rebuild the ChromaDB index from the storage backend
   */
  router.post('/reindex', async (_req, res, next) => {
    try {
      const count = await searchService.reindex(storage);
      res.json({ success: true, data: { indexed: count } });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
