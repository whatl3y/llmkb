import { describe, it, expect } from 'vitest';
import { parseTextContent } from '../../../src/core/parser/text.js';

describe('parseTextContent', () => {
  it('parses plain text with explicit title', () => {
    const result = parseTextContent('Some content here.', 'My Article');
    expect(result.title).toBe('My Article');
    expect(result.content).toBe('Some content here.');
    expect(result.sourceType).toBe('text');
  });

  it('extracts title from markdown heading', () => {
    const content = '# My Heading\n\nSome content.';
    const result = parseTextContent(content);
    expect(result.title).toBe('My Heading');
  });

  it('uses first line as title if short enough', () => {
    const content = 'Short Title\n\nContent goes here.';
    const result = parseTextContent(content);
    expect(result.title).toBe('Short Title');
  });

  it('falls back to Untitled when no title derivable', () => {
    const longLine = 'x'.repeat(200) + '\n\nContent';
    const result = parseTextContent(longLine);
    expect(result.title).toBe('Untitled');
  });

  it('trims whitespace from content', () => {
    const result = parseTextContent('  \n  content  \n  ', 'Test');
    expect(result.content).toBe('content');
  });
});
