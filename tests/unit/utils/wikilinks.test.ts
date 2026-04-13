import { describe, it, expect } from 'vitest';
import {
  extractWikilinks,
  wikilinkToMarkdownLink,
  findBrokenWikilinks,
  countInboundLinks,
} from '../../../src/utils/wikilinks.js';

describe('extractWikilinks', () => {
  it('extracts simple wikilinks', () => {
    const content = 'See [[page-one]] and [[page-two]] for details.';
    expect(extractWikilinks(content)).toEqual(['page-one', 'page-two']);
  });

  it('deduplicates repeated links', () => {
    const content = 'See [[page-one]] and later [[page-one]] again.';
    expect(extractWikilinks(content)).toEqual(['page-one']);
  });

  it('returns empty array when no links', () => {
    expect(extractWikilinks('No links here.')).toEqual([]);
  });

  it('extracts links with display text', () => {
    const content = 'See [[page-one|Display Text]].';
    expect(extractWikilinks(content)).toEqual(['page-one|Display Text']);
  });
});

describe('wikilinkToMarkdownLink', () => {
  it('converts simple wikilinks', () => {
    const result = wikilinkToMarkdownLink('See [[my-page]].');
    expect(result).toBe('See [my-page](/browse/my-page).');
  });

  it('converts wikilinks with display text', () => {
    const result = wikilinkToMarkdownLink('See [[my-page|My Page]].');
    expect(result).toBe('See [My Page](/browse/my-page).');
  });

  it('uses custom base path', () => {
    const result = wikilinkToMarkdownLink('[[page]]', '/wiki');
    expect(result).toBe('[page](/wiki/page)');
  });
});

describe('findBrokenWikilinks', () => {
  it('finds links pointing to non-existent pages', () => {
    const known = new Set(['page-one', 'page-two']);
    const content = 'See [[page-one]], [[page-three]], and [[page-two]].';
    expect(findBrokenWikilinks(content, known)).toEqual(['page-three']);
  });

  it('returns empty when all links exist', () => {
    const known = new Set(['a', 'b']);
    expect(findBrokenWikilinks('[[a]] and [[b]]', known)).toEqual([]);
  });
});

describe('countInboundLinks', () => {
  it('counts inbound links across pages', () => {
    const pages = new Map([
      ['page-a', 'Links to [[page-b]] and [[page-c]]'],
      ['page-b', 'Links to [[page-c]]'],
      ['page-c', 'No outbound links'],
    ]);

    const counts = countInboundLinks(pages);
    expect(counts.get('page-b')).toBe(1);
    expect(counts.get('page-c')).toBe(2);
    expect(counts.has('page-a')).toBe(false);
  });
});
