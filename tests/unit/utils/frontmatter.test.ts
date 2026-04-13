import { describe, it, expect } from 'vitest';
import { parseWikiPage, buildPageContent, extractSlug, toKebabCase, today } from '../../../src/utils/frontmatter.js';

describe('extractSlug', () => {
  it('extracts slug from file path', () => {
    expect(extractSlug('wiki/concepts/active-inference.md')).toBe('active-inference');
  });

  it('handles nested paths', () => {
    expect(extractSlug('/data/wiki/entities/openai.md')).toBe('openai');
  });
});

describe('toKebabCase', () => {
  it('converts spaces to hyphens', () => {
    expect(toKebabCase('Hello World')).toBe('hello-world');
  });

  it('lowercases everything', () => {
    expect(toKebabCase('LLM Integration')).toBe('llm-integration');
  });

  it('removes special characters', () => {
    expect(toKebabCase('What is RAG?')).toBe('what-is-rag');
  });

  it('collapses multiple hyphens', () => {
    expect(toKebabCase('one -- two --- three')).toBe('one-two-three');
  });

  it('trims leading/trailing hyphens', () => {
    expect(toKebabCase(' hello ')).toBe('hello');
  });
});

describe('today', () => {
  it('returns YYYY-MM-DD format', () => {
    const result = today();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('parseWikiPage', () => {
  it('parses frontmatter and content', () => {
    const raw = `---
title: "Test Page"
date_created: 2026-04-08
date_modified: 2026-04-08
summary: "A test page"
tags: [test]
type: concept
status: draft
---

# Test Page

Some content here.`;

    const page = parseWikiPage(raw, 'wiki/concepts/test-page.md');
    expect(page.slug).toBe('test-page');
    expect(page.frontmatter.title).toBe('Test Page');
    expect(page.frontmatter.type).toBe('concept');
    expect(page.content).toContain('# Test Page');
  });
});

describe('buildPageContent', () => {
  it('builds a valid markdown file with frontmatter', () => {
    const fm = {
      title: 'Test',
      date_created: '2026-04-08',
      date_modified: '2026-04-08',
      summary: 'A test',
      tags: ['test'],
      type: 'concept' as const,
      status: 'draft' as const,
    };
    const result = buildPageContent(fm, '# Test\n\nBody.');
    expect(result).toContain('---');
    expect(result).toContain('title: "Test"');
    expect(result).toContain('type: concept');
    expect(result).toContain('# Test');
    expect(result).toContain('Body.');
  });

  it('includes optional fields when present', () => {
    const fm = {
      title: 'Source',
      date_created: '2026-04-08',
      date_modified: '2026-04-08',
      summary: 'A source',
      tags: ['api'],
      type: 'source' as const,
      status: 'final' as const,
      source_url: 'https://example.com',
      authors: ['Alice', 'Bob'],
      source_count: 3,
      confidence: 'established' as const,
    };
    const result = buildPageContent(fm, 'Body');
    expect(result).toContain('source_url: "https://example.com"');
    expect(result).toContain('"Alice"');
    expect(result).toContain('source_count: 3');
    expect(result).toContain('confidence: established');
  });
});
