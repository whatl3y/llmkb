import { marked } from 'marked';
import { wikilinkToMarkdownLink } from './wikilinks.js';

/**
 * Render wiki markdown to HTML.
 * Converts [[wikilinks]] to clickable links before rendering.
 */
export function renderMarkdown(content: string): string {
  const withLinks = wikilinkToMarkdownLink(content);
  return marked.parse(withLinks) as string;
}

/**
 * Extract a plain-text excerpt from markdown content.
 */
export function excerpt(content: string, maxLength = 200): string {
  // Strip frontmatter
  const body = content.replace(/^---[\s\S]*?---\n*/, '');

  // Strip markdown syntax
  const plain = body
    .replace(/#{1,6}\s+/g, '')
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, slug, display) => display || slug)
    .replace(/`{1,3}[^`]*`{1,3}/g, '')
    .replace(/\n+/g, ' ')
    .trim();

  if (plain.length <= maxLength) return plain;
  return plain.slice(0, maxLength).replace(/\s\S*$/, '') + '...';
}

/**
 * Strip YAML frontmatter from markdown content.
 */
export function stripFrontmatter(content: string): string {
  return content.replace(/^---[\s\S]*?---\n*/, '').trim();
}
