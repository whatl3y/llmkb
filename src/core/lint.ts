import matter from 'gray-matter';
import type { LintReport, LintIssue, KBConfig } from '../types/index.js';
import { extractWikilinks, findBrokenWikilinks, countInboundLinks } from '../utils/wikilinks.js';
import { today } from '../utils/frontmatter.js';
import type { StorageBackend } from './storage/types.js';

export class LintService {
  constructor(
    private storage: StorageBackend,
    private config: KBConfig
  ) {}

  async run(): Promise<LintReport> {
    const issues: LintIssue[] = [];

    // Collect all wiki pages
    const pages = await this.collectPages();
    const knownSlugs = new Set(pages.map((p) => p.slug));
    const pageContentMap = new Map<string, string>();
    for (const page of pages) {
      pageContentMap.set(page.slug, page.content);
    }

    // Check for broken wikilinks
    for (const page of pages) {
      const broken = findBrokenWikilinks(page.content, knownSlugs);
      for (const link of broken) {
        issues.push({
          type: 'broken_link',
          severity: 'warning',
          page: page.relativePath,
          message: `Broken wikilink [[${link}]] — no page found with this slug`,
          autoFixed: false,
        });
      }
    }

    // Check for orphan pages (no inbound links, excluding index and log)
    const inboundCounts = countInboundLinks(pageContentMap);
    for (const page of pages) {
      if (page.slug === 'index' || page.slug === 'log') continue;
      if (!inboundCounts.has(page.slug) || inboundCounts.get(page.slug) === 0) {
        issues.push({
          type: 'orphan',
          severity: 'info',
          page: page.relativePath,
          message: `Orphan page — no other pages link to [[${page.slug}]]`,
          autoFixed: false,
        });
      }
    }

    // Check for incomplete frontmatter
    const requiredFields = ['title', 'date_created', 'date_modified', 'summary', 'type', 'status', 'tags'];
    for (const page of pages) {
      if (page.slug === 'index' || page.slug === 'log') continue;
      const missing = requiredFields.filter((f) => !(f in page.frontmatter));
      if (missing.length > 0) {
        issues.push({
          type: 'incomplete_metadata',
          severity: 'warning',
          page: page.relativePath,
          message: `Missing frontmatter fields: ${missing.join(', ')}`,
          autoFixed: false,
        });
      }
    }

    // Check for stale content (source date > 6 months old, no updates)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    for (const page of pages) {
      if (page.frontmatter.date_modified) {
        const modified = new Date(page.frontmatter.date_modified as string);
        if (modified < sixMonthsAgo) {
          issues.push({
            type: 'stale',
            severity: 'info',
            page: page.relativePath,
            message: `Last modified ${page.frontmatter.date_modified} — may be outdated`,
            autoFixed: false,
          });
        }
      }
    }

    // Find frequently linked but non-existent concepts (missing pages)
    const allLinks = new Map<string, number>();
    for (const page of pages) {
      const links = extractWikilinks(page.content);
      for (const link of links) {
        const slug = link.split('|')[0].trim();
        if (!knownSlugs.has(slug)) {
          allLinks.set(slug, (allLinks.get(slug) ?? 0) + 1);
        }
      }
    }
    const missingPages = [...allLinks.entries()]
      .filter(([, count]) => count >= 2)
      .sort(([, a], [, b]) => b - a);

    for (const [slug, count] of missingPages) {
      issues.push({
        type: 'missing_page',
        severity: 'warning',
        message: `[[${slug}]] is referenced ${count} times but has no page — consider creating a stub`,
        autoFixed: false,
      });
    }

    const fixedCount = 0; // Future: auto-fix issues

    // Save the report
    const report: LintReport = {
      date: today(),
      issues,
      fixedCount,
      suggestedQuestions: this.generateSuggestedQuestions(pages),
    };

    await this.saveReport(report);

    return report;
  }

  private generateSuggestedQuestions(
    pages: Array<{ slug: string; frontmatter: Record<string, unknown> }>
  ): string[] {
    const concepts = pages
      .filter((p) => (p.frontmatter.type as string) === 'concept')
      .map((p) => p.frontmatter.title as string)
      .slice(0, 5);

    if (concepts.length < 2) {
      return [`What are the key considerations for ${this.config.topic}?`];
    }

    return [
      `How do ${concepts[0]} and ${concepts[1]} relate in the context of ${this.config.topic}?`,
      `What are the trade-offs between different approaches to ${concepts[0]}?`,
      `What are common pitfalls when implementing ${concepts[concepts.length - 1]}?`,
    ];
  }

  private async saveReport(report: LintReport): Promise<void> {
    const lines = [
      `# Lint Report — ${report.date}\n`,
      `**Issues found:** ${report.issues.length}`,
      `**Auto-fixed:** ${report.fixedCount}\n`,
    ];

    const grouped = new Map<string, LintIssue[]>();
    for (const issue of report.issues) {
      const list = grouped.get(issue.type) ?? [];
      list.push(issue);
      grouped.set(issue.type, list);
    }

    for (const [type, issues] of grouped) {
      lines.push(`## ${type.replace(/_/g, ' ').toUpperCase()} (${issues.length})\n`);
      for (const issue of issues) {
        const prefix = issue.autoFixed ? '~~' : '';
        const suffix = issue.autoFixed ? '~~ *(fixed)*' : '';
        const page = issue.page ? ` in ${issue.page}` : '';
        lines.push(`- ${prefix}${issue.message}${page}${suffix}`);
      }
      lines.push('');
    }

    if (report.suggestedQuestions.length > 0) {
      lines.push('## Suggested Research Questions\n');
      for (const q of report.suggestedQuestions) {
        lines.push(`- ${q}`);
      }
    }

    await this.storage.writePage('outputs', `lint-report-${report.date}`, lines.join('\n'));

    // Update log
    let log = await this.storage.readLog();
    log += `\n## [${report.date}] lint | Health Check\n- Found ${report.issues.length} issues, fixed ${report.fixedCount}\n- Report: wiki/outputs/lint-report-${report.date}.md\n`;
    await this.storage.writeLog(log);
  }

  private async collectPages(): Promise<
    Array<{ slug: string; relativePath: string; content: string; frontmatter: Record<string, unknown> }>
  > {
    const allPages = await this.storage.listAllPagesWithContent();
    return allPages.map(({ type, slug, raw }) => {
      const { data } = matter(raw);
      return {
        slug,
        relativePath: `wiki/${type}/${slug}.md`,
        content: raw,
        frontmatter: data,
      };
    });
  }
}
