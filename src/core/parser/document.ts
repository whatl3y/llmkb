import mammoth from 'mammoth';
import WordExtractor from 'word-extractor';
import type { ParsedSource } from '../../types/index.js';

/**
 * Parse DOCX files using mammoth (high-quality extraction).
 */
export async function parseDocxBuffer(buffer: Buffer, filename?: string): Promise<ParsedSource> {
  const result = await mammoth.extractRawText({ buffer });
  const title = filename ? extractTitleFromFilename(filename) : 'Untitled Document';

  return {
    title,
    content: result.value.trim(),
    sourceType: 'text',
  };
}

/**
 * Parse legacy DOC files using word-extractor.
 */
export async function parseDocBuffer(buffer: Buffer, filename?: string): Promise<ParsedSource> {
  const extractor = new WordExtractor();
  const doc = await extractor.extract(buffer);
  const title = filename ? extractTitleFromFilename(filename) : 'Untitled Document';

  return {
    title,
    content: doc.getBody().trim(),
    sourceType: 'text',
  };
}

function extractTitleFromFilename(filename: string): string {
  return filename.replace(/\.\w+$/, '').replace(/[-_]/g, ' ');
}
