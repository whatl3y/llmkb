import matter from 'gray-matter';
import type { PageFrontmatter, WikiPage } from '../types/index.js';

export function parseWikiPage(raw: string, filePath: string): WikiPage {
  const { data, content } = matter(raw);
  const slug = extractSlug(filePath);

  return {
    path: filePath,
    slug,
    frontmatter: data as PageFrontmatter,
    content: content.trim(),
    raw,
  };
}

export function buildPageContent(frontmatter: PageFrontmatter, body: string): string {
  const fm = [
    '---',
    `title: "${frontmatter.title}"`,
    `date_created: ${frontmatter.date_created}`,
    `date_modified: ${frontmatter.date_modified}`,
    `summary: "${frontmatter.summary.replace(/"/g, '\\"')}"`,
    `tags: [${frontmatter.tags.join(', ')}]`,
    `type: ${frontmatter.type}`,
    `status: ${frontmatter.status}`,
  ];

  if (frontmatter.source_url) fm.push(`source_url: "${frontmatter.source_url}"`);
  if (frontmatter.source_file) fm.push(`source_file: "${frontmatter.source_file}"`);
  if (frontmatter.authors?.length) fm.push(`authors: [${frontmatter.authors.map((a) => `"${a}"`).join(', ')}]`);
  if (frontmatter.related?.length) fm.push(`related: [${frontmatter.related.map((r) => `"${r}"`).join(', ')}]`);
  if (frontmatter.source_count != null) fm.push(`source_count: ${frontmatter.source_count}`);
  if (frontmatter.confidence) fm.push(`confidence: ${frontmatter.confidence}`);

  fm.push('---');

  return fm.join('\n') + '\n\n' + body + '\n';
}

export function extractSlug(filePath: string): string {
  const filename = filePath.split('/').pop() ?? '';
  return filename.replace(/\.md$/, '');
}

export function toKebabCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function today(): string {
  return new Date().toISOString().split('T')[0];
}
