import officeparser from 'officeparser';
import type { ParsedSource } from '../../types/index.js';

/**
 * Parse PPT or PPTX files into plain text using officeparser.
 */
export async function parsePresentationBuffer(buffer: Buffer, filename?: string): Promise<ParsedSource> {
  const ast = await officeparser.parseOffice(buffer);
  // Extract text content from AST nodes
  const text = extractText(ast);
  const title = filename ? filename.replace(/\.\w+$/, '').replace(/[-_]/g, ' ') : 'Untitled Presentation';

  return {
    title,
    content: text.trim(),
    sourceType: 'text',
  };
}

/** Recursively extract plain text from an OfficeParser AST */
function extractText(node: unknown): string {
  if (typeof node === 'string') return node;
  if (!node || typeof node !== 'object') return '';

  // Handle arrays
  if (Array.isArray(node)) {
    return node.map(extractText).join('');
  }

  const obj = node as Record<string, unknown>;

  // If it has a 'text' property, use that
  if (typeof obj.text === 'string') return obj.text + '\n';

  // If it has 'children', recurse
  if (Array.isArray(obj.children)) {
    return obj.children.map(extractText).join('');
  }

  // If it has 'content', recurse
  if (Array.isArray(obj.content)) {
    return obj.content.map(extractText).join('');
  }

  // Fallback: try toString
  const str = String(node);
  return str === '[object Object]' ? '' : str;
}
