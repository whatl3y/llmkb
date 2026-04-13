import * as cheerio from 'cheerio';
import type { ParsedSource } from '../../types/index.js';

export async function parseUrl(url: string): Promise<ParsedSource> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; LLM-KB-Bot/1.0)',
      'Accept': 'text/html,application/xhtml+xml',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  // Remove non-content elements
  $('script, style, nav, footer, header, aside, iframe, noscript').remove();
  $('[role="navigation"], [role="banner"], [role="complementary"]').remove();

  const title =
    $('meta[property="og:title"]').attr('content') ||
    $('title').text().trim() ||
    $('h1').first().text().trim() ||
    'Untitled';

  const author =
    $('meta[name="author"]').attr('content') ||
    $('meta[property="article:author"]').attr('content') ||
    undefined;

  // Extract main content — try common content selectors, fall back to body
  const contentSelectors = ['article', 'main', '[role="main"]', '.post-content', '.article-content', '.entry-content'];
  let content = '';

  for (const selector of contentSelectors) {
    const el = $(selector);
    if (el.length) {
      content = el.text().trim();
      break;
    }
  }

  if (!content) {
    content = $('body').text().trim();
  }

  // Collapse whitespace
  content = content.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+/g, ' ');

  return {
    title,
    content,
    sourceType: 'url',
    sourceUrl: url,
    authors: author ? [author] : undefined,
    rawContent: html,
  };
}
