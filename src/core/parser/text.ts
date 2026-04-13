import fs from 'fs/promises';
import type { ParsedSource } from '../../types/index.js';

export async function parseTextFile(filePath: string): Promise<ParsedSource> {
  const content = await fs.readFile(filePath, 'utf-8');
  const title = extractTitleFromContent(content) || extractTitleFromPath(filePath);

  return {
    title,
    content: content.trim(),
    sourceType: 'text',
  };
}

export function parseTextContent(text: string, title?: string): ParsedSource {
  return {
    title: title || extractTitleFromContent(text) || 'Untitled',
    content: text.trim(),
    sourceType: 'text',
  };
}

function extractTitleFromContent(content: string): string | null {
  // Try first markdown heading
  const headingMatch = content.match(/^#\s+(.+)$/m);
  if (headingMatch) return headingMatch[1].trim();

  // Try first non-empty line if short enough to be a title
  const firstLine = content.split('\n').find((line) => line.trim().length > 0);
  if (firstLine && firstLine.trim().length <= 120) return firstLine.trim();

  return null;
}

function extractTitleFromPath(filePath: string): string {
  const filename = filePath.split('/').pop() ?? 'untitled';
  return filename.replace(/\.\w+$/, '').replace(/[-_]/g, ' ');
}
