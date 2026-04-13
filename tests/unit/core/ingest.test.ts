import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { IngestService } from '../../../src/core/ingest.js';
import { FileSystemStorage } from '../../../src/core/storage/filesystem.js';
import type { LLMProvider, CompletionResult, KBConfig } from '../../../src/types/index.js';

// Mock LLM provider
function createMockLLM(response: string): LLMProvider {
  return {
    name: 'mock',
    model: 'mock-v1',
    complete: vi.fn().mockResolvedValue({
      content: response,
      usage: { inputTokens: 100, outputTokens: 200 },
    } satisfies CompletionResult),
    async *stream() { yield response; },
  };
}

// Mock search service
function createMockSearch() {
  return {
    indexPage: vi.fn().mockResolvedValue(undefined),
    indexPages: vi.fn().mockResolvedValue(undefined),
    search: vi.fn().mockResolvedValue([]),
    removePage: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn().mockResolvedValue(undefined),
  };
}

const TEST_DATA_DIR = '/tmp/llm-kb-test-ingest';

const TEST_CONFIG: KBConfig = {
  name: 'Test Wiki',
  topic: 'Adding LLM support to applications',
  description: 'Test knowledge base.',
  focusPrompt: 'Focus on information relevant to integrating LLMs into applications',
};

const MOCK_LLM_RESPONSE = JSON.stringify({
  sourceSummary: {
    title: 'Test Article About LLM APIs',
    summary: 'An article about integrating LLMs into applications via APIs.',
    tags: ['llm', 'api'],
    authors: ['Test Author'],
    sourceUrl: '',
    fullArticle: 'This article covers [[llm-api-integration]] and discusses various approaches to building with [[large-language-models]].',
  },
  concepts: [
    {
      name: 'LLM API Integration',
      slug: 'llm-api-integration',
      description: 'The process of connecting applications to large language model APIs.',
      relatedConcepts: ['large-language-models'],
    },
  ],
  entities: [
    {
      name: 'OpenAI',
      slug: 'openai',
      description: 'AI research company that provides the GPT series of models.',
      entityType: 'organization',
    },
  ],
});

let storage: FileSystemStorage;

describe('IngestService', () => {
  beforeEach(async () => {
    storage = new FileSystemStorage(TEST_DATA_DIR);
    await storage.initialize(TEST_CONFIG.topic);
  });

  afterEach(async () => {
    await fs.rm(TEST_DATA_DIR, { recursive: true, force: true });
  });

  it('processes a text source and creates wiki pages', async () => {
    const llm = createMockLLM(MOCK_LLM_RESPONSE);
    const search = createMockSearch();
    const service = new IngestService(llm, search as never, storage, TEST_CONFIG);

    const result = await service.process({
      sourceType: 'text',
      content: 'An article about LLM API integration...',
      title: 'Test Article',
    });

    // Verify the LLM was called
    expect(llm.complete).toHaveBeenCalledOnce();

    // Verify result structure
    expect(result.sourceSummary.title).toBe('Test Article About LLM APIs');
    expect(result.concepts).toHaveLength(1);
    expect(result.concepts[0].slug).toBe('llm-api-integration');
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].slug).toBe('openai');

    // Verify source file was created
    const sourceFile = await storage.readPage('sources', 'test-article-about-llm-apis');
    expect(sourceFile).toContain('title: "Test Article About LLM APIs"');
    expect(sourceFile).toContain('type: source');

    // Verify concept file was created
    const conceptFile = await storage.readPage('concepts', 'llm-api-integration');
    expect(conceptFile).toContain('LLM API Integration');
    expect(conceptFile).toContain('type: concept');

    // Verify entity file was created
    const entityFile = await storage.readPage('entities', 'openai');
    expect(entityFile).toContain('OpenAI');
    expect(entityFile).toContain('type: entity');

    // Verify search indexing was called
    expect(search.indexPages).toHaveBeenCalled();

    // Verify index was created/updated
    const indexFile = await storage.readIndex();
    expect(indexFile).toContain('test-article-about-llm-apis');

    // Verify log was created/updated
    const logFile = await storage.readLog();
    expect(logFile).toContain('ingest');
    expect(logFile).toContain('Test Article About LLM APIs');
  });

  it('appends to existing concept pages instead of overwriting', async () => {
    // Pre-create an existing concept page
    await storage.writePage('concepts', 'llm-api-integration',
      '---\ntitle: "LLM API Integration"\n---\n\n# LLM API Integration\n\nExisting content.\n'
    );

    const llm = createMockLLM(MOCK_LLM_RESPONSE);
    const search = createMockSearch();
    const service = new IngestService(llm, search as never, storage, TEST_CONFIG);

    await service.process({
      sourceType: 'text',
      content: 'New article about LLM APIs.',
    });

    const conceptFile = await storage.readPage('concepts', 'llm-api-integration');

    // Should contain both old and new content
    expect(conceptFile).toContain('Existing content.');
    expect(conceptFile).toContain('Additional Context');
  });

  it('handles LLM returning invalid JSON gracefully', async () => {
    const llm = createMockLLM('This is not valid JSON');
    const search = createMockSearch();
    const service = new IngestService(llm, search as never, storage, TEST_CONFIG);

    await expect(
      service.process({ sourceType: 'text', content: 'Test.' })
    ).rejects.toThrow('LLM returned invalid JSON');
  });
});
