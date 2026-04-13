import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs/promises';
import path from 'path';
import { createWikiRouter } from '../../src/server/routes/wiki.js';
import { errorHandler } from '../../src/server/middleware/error.js';
import { FileSystemStorage } from '../../src/core/storage/filesystem.js';

const TEST_DATA_DIR = '/tmp/llm-kb-test-api';
const storage = new FileSystemStorage(TEST_DATA_DIR);

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/wiki', createWikiRouter(storage));
  app.use(errorHandler);
  return app;
}

describe('Wiki API routes', () => {
  beforeAll(async () => {
    await storage.initialize('test');

    // Create test pages
    await storage.writeIndex(
      '---\ntitle: "Wiki Index"\ndate_modified: 2026-04-08\n---\n\n# Wiki Index\n\n## Concepts\n- [[test-concept]] — A test\n'
    );

    await storage.writeLog(
      '# Wiki Log\n\n## [2026-04-08] ingest | Test\n- Created: wiki/concepts/test-concept.md\n'
    );

    await storage.writePage('concepts', 'test-concept',
      '---\ntitle: "Test Concept"\ndate_created: 2026-04-08\ndate_modified: 2026-04-08\nsummary: "A test concept"\ntags: [test]\ntype: concept\nstatus: draft\n---\n\n# Test Concept\n\nThis is a test concept about [[llm-integration]].\n'
    );
  });

  afterAll(async () => {
    await fs.rm(TEST_DATA_DIR, { recursive: true, force: true });
  });

  describe('GET /api/wiki/stats', () => {
    it('returns wiki statistics', async () => {
      const app = createTestApp();
      const res = await request(app).get('/api/wiki/stats');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.totalPages).toBeGreaterThanOrEqual(1);
      expect(res.body.data.concepts).toBe(1);
      expect(typeof res.body.data.recentActivity).toBe('object');
    });
  });

  describe('GET /api/wiki/pages', () => {
    it('lists all pages', async () => {
      const app = createTestApp();
      const res = await request(app).get('/api/wiki/pages');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);

      const concept = res.body.data.find((p: { slug: string }) => p.slug === 'test-concept');
      expect(concept).toBeDefined();
      expect(concept.title).toBe('Test Concept');
      expect(concept.type).toBe('concepts');
    });
  });

  describe('GET /api/wiki/page/:type/:slug', () => {
    it('returns a specific page', async () => {
      const app = createTestApp();
      const res = await request(app).get('/api/wiki/page/concepts/test-concept');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.slug).toBe('test-concept');
      expect(res.body.data.frontmatter.title).toBe('Test Concept');
      expect(res.body.data.content).toContain('# Test Concept');
    });

    it('returns 404 for non-existent page', async () => {
      const app = createTestApp();
      const res = await request(app).get('/api/wiki/page/concepts/does-not-exist');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe('GET /api/wiki/index', () => {
    it('returns the master index', async () => {
      const app = createTestApp();
      const res = await request(app).get('/api/wiki/index');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.content).toContain('Wiki Index');
    });
  });
});
