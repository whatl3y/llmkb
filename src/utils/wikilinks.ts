/**
 * Extract all [[wikilinks]] from markdown content.
 */
export function extractWikilinks(content: string): string[] {
  const matches = content.match(/\[\[([^\]]+)\]\]/g);
  if (!matches) return [];
  return [...new Set(matches.map((m) => m.slice(2, -2)))];
}

/**
 * Convert [[wikilinks]] to markdown links for HTML rendering.
 * [[page-name]] → [page-name](/browse/page-name)
 * [[page-name|Display Text]] → [Display Text](/browse/page-name)
 */
export function wikilinkToMarkdownLink(content: string, basePath = '/browse'): string {
  return content.replace(/\[\[([^\]]+)\]\]/g, (_match, inner: string) => {
    const parts = inner.split('|');
    const slug = parts[0].trim();
    const display = (parts[1] || parts[0]).trim();
    return `[${display}](${basePath}/${slug})`;
  });
}

/**
 * Check if a page slug exists in a set of known pages.
 */
export function findBrokenWikilinks(content: string, knownPages: Set<string>): string[] {
  const links = extractWikilinks(content);
  return links.filter((link) => !knownPages.has(link.split('|')[0].trim()));
}

/**
 * Count inbound links to each page across all provided pages.
 */
export function countInboundLinks(pages: Map<string, string>): Map<string, number> {
  const counts = new Map<string, number>();

  for (const [, content] of pages) {
    const links = extractWikilinks(content);
    for (const link of links) {
      const slug = link.split('|')[0].trim();
      counts.set(slug, (counts.get(slug) ?? 0) + 1);
    }
  }

  return counts;
}
