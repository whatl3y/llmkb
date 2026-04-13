import { Router } from 'express';
import matter from 'gray-matter';
import type { WikiStats, LogEntry } from '../../types/index.js';
import { excerpt } from '../../utils/markdown.js';
import type { StorageBackend } from '../../core/storage/types.js';

export function createWikiRouter(storage: StorageBackend): Router {
  const router = Router();

  /**
   * GET /api/wiki/stats — wiki overview statistics
   */
  router.get('/stats', async (_req, res, next) => {
    try {
      const stats = await getWikiStats(storage);
      res.json({ success: true, data: stats });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/wiki/pages — list all pages with metadata
   */
  router.get('/pages', async (_req, res, next) => {
    try {
      const pages = await listPages(storage);
      res.json({ success: true, data: pages });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/wiki/page/:type/:slug — get a specific wiki page
   */
  router.get('/page/:type/:slug', async (req, res, next) => {
    try {
      const { type, slug } = req.params;
      const raw = await storage.readPage(type, slug);

      if (!raw) {
        res.status(404).json({ success: false, error: 'Page not found' });
        return;
      }

      const { data, content } = matter(raw);

      res.json({
        success: true,
        data: {
          slug,
          type,
          frontmatter: data,
          content,
          raw,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/wiki/index — get the master index
   */
  router.get('/index', async (_req, res, next) => {
    try {
      const raw = await storage.readIndex();
      if (!raw) {
        res.json({ success: true, data: { frontmatter: {}, content: '', raw: '' } });
        return;
      }
      const { data, content } = matter(raw);
      res.json({ success: true, data: { frontmatter: data, content, raw } });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/wiki/download/:slug/:filename — download an original source file
   */
  router.get('/download/:slug/:filename', async (req, res, next) => {
    try {
      const { slug, filename } = req.params;

      if (slug.includes('..') || filename.includes('..') || slug.includes('/') || filename.includes('/')) {
        res.status(400).json({ success: false, error: 'Invalid path' });
        return;
      }

      const stream = await storage.getUploadStream(slug, filename);
      if (!stream) {
        res.status(404).json({ success: false, error: 'File not found' });
        return;
      }

      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      stream.pipe(res);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

async function getWikiStats(storage: StorageBackend): Promise<WikiStats> {
  const counts = { concepts: 0, entities: 0, sources: 0, syntheses: 0, outputs: 0 };
  const dirs: Array<[keyof typeof counts, string]> = [
    ['concepts', 'concepts'],
    ['entities', 'entities'],
    ['sources', 'sources'],
    ['syntheses', 'syntheses'],
    ['outputs', 'outputs'],
  ];

  for (const [key, dir] of dirs) {
    const slugs = await storage.listPageSlugs(dir);
    counts[key] = slugs.length;
  }

  const recentActivity = await getRecentActivity(storage);

  return {
    totalPages: counts.concepts + counts.entities + counts.sources + counts.syntheses + counts.outputs,
    ...counts,
    recentActivity,
  };
}

async function getRecentActivity(storage: StorageBackend): Promise<LogEntry[]> {
  try {
    const logContent = await storage.readLog();
    const entries: LogEntry[] = [];
    const entryRegex = /^## \[(\d{4}-\d{2}-\d{2})\] (\w+) \| (.+)$/gm;
    let match;

    while ((match = entryRegex.exec(logContent)) !== null) {
      // Collect detail lines until the next entry
      const restStart = match.index + match[0].length;
      const nextEntry = logContent.indexOf('\n## [', restStart);
      const detailBlock = logContent.slice(restStart, nextEntry === -1 ? undefined : nextEntry).trim();
      const details = detailBlock
        .split('\n')
        .filter((l) => l.startsWith('- '))
        .map((l) => l.slice(2));

      entries.push({
        date: match[1],
        operation: match[2] as LogEntry['operation'],
        title: match[3],
        details,
      });
    }

    return entries.reverse().slice(0, 20);
  } catch {
    return [];
  }
}

async function listPages(storage: StorageBackend): Promise<Array<Record<string, unknown>>> {
  const allPages = await storage.listAllPagesWithContent();
  const pages: Array<Record<string, unknown>> = [];

  for (const { type, slug, raw } of allPages) {
    try {
      const { data, content } = matter(raw);
      pages.push({
        slug,
        type,
        title: data.title || slug,
        summary: data.summary || excerpt(content),
        tags: data.tags || [],
        date_modified: data.date_modified,
        status: data.status,
      });
    } catch {
      // Skip malformed files
    }
  }

  return pages;
}
