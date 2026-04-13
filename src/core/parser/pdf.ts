import fs from 'fs/promises';
import pdf from 'pdf-parse';
import officeparser from 'officeparser';
import type { ParsedSource } from '../../types/index.js';

export async function parsePdf(filePath: string): Promise<ParsedSource> {
  const buffer = await fs.readFile(filePath);
  return parsePdfBuffer(buffer, filePath.split('/').pop());
}

export async function parsePdfBuffer(buffer: Buffer, filename?: string): Promise<ParsedSource> {
  const fallbackTitle = filename ? extractTitleFromPath(filename) : 'Untitled PDF';

  // Try pdf-parse first (better metadata extraction)
  try {
    const data = await pdf(buffer);
    if (data.text.trim().length > 0) {
      return {
        title: data.info?.Title || fallbackTitle,
        content: data.text.trim(),
        sourceType: 'pdf',
        authors: data.info?.Author ? [data.info.Author] : undefined,
      };
    }
  } catch {
    // pdf-parse failed — fall through to officeparser
  }

  // Fallback: officeparser handles PDFs that pdf-parse chokes on
  // (encrypted, image-heavy, certain encoding issues)
  try {
    const ast = await officeparser.parseOffice(buffer);
    const text = String(ast);
    if (text && text !== '[object Object]' && text.trim().length > 0) {
      return {
        title: fallbackTitle,
        content: text.trim(),
        sourceType: 'pdf',
      };
    }
  } catch {
    // Both parsers failed
  }

  throw new Error(
    `Could not extract text from PDF${filename ? ` "${filename}"` : ''}. ` +
    'The file may be image-only (scanned), encrypted, or corrupted.'
  );
}

function extractTitleFromPath(filePath: string): string {
  const filename = filePath.split('/').pop() ?? 'untitled';
  return filename.replace(/\.pdf$/i, '').replace(/[-_]/g, ' ');
}
