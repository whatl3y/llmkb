import * as XLSX from 'xlsx';
import type { ParsedSource } from '../../types/index.js';

/**
 * Parse CSV, XLS, or XLSX files into plain text.
 * Each sheet is converted to CSV format for the LLM to read.
 */
export function parseSpreadsheetBuffer(buffer: Buffer, filename?: string): ParsedSource {
  const workbook = XLSX.read(buffer);
  const sections: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(sheet);
    if (csv.trim()) {
      const header = workbook.SheetNames.length > 1 ? `## Sheet: ${sheetName}\n\n` : '';
      sections.push(`${header}${csv}`);
    }
  }

  const content = sections.join('\n\n');
  const title = filename ? extractTitleFromFilename(filename) : 'Untitled Spreadsheet';

  return {
    title,
    content,
    sourceType: 'text',
  };
}

function extractTitleFromFilename(filename: string): string {
  return filename.replace(/\.\w+$/, '').replace(/[-_]/g, ' ');
}
