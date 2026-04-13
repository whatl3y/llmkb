import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import type { LLMProvider, ParsedSource, IngestResult, IngestRequest, PageFrontmatter, KBConfig } from '../types/index.js';
import { parseUrl } from './parser/url.js';
import { parsePdf, parsePdfBuffer } from './parser/pdf.js';
import { parseTextFile, parseTextContent } from './parser/text.js';
import { buildPageContent, toKebabCase, today } from '../utils/frontmatter.js';
import { SearchService } from './search.js';
import type { StorageBackend, HashEntry } from './storage/types.js';

function buildIngestSystemPrompt(topic: string, focusPrompt: string): string {
  return `You are a knowledge base compiler for a wiki about "${topic}."
Your job is to analyze source material and extract structured information.

You MUST respond with valid JSON only — no markdown fences, no commentary.

The JSON must have this exact structure:
{
  "sourceSummary": {
    "title": "string — concise title for this source",
    "summary": "string — 200-500 word synthesis of the key points (do NOT copy verbatim)",
    "tags": ["string array of topic tags in kebab-case"],
    "authors": ["string array of author names if identifiable, else empty"],
    "sourceUrl": "string — original URL if known, else empty string",
    "fullArticle": "string — a comprehensive 500-1500 word wiki article synthesizing the source content, using [[wikilinks]] to reference concepts and entities"
  },
  "concepts": [
    {
      "name": "string — human-readable concept name",
      "slug": "string — kebab-case slug",
      "description": "string — 100-300 word explanation of this concept",
      "relatedConcepts": ["string array of related concept slugs"]
    }
  ],
  "entities": [
    {
      "name": "string — entity name",
      "slug": "string — kebab-case slug",
      "description": "string — 50-200 word description",
      "entityType": "person | organization | tool | framework | service"
    }
  ]
}

Rules:
- Extract 2-8 key concepts from the source material
- Extract relevant entities (tools, frameworks, people, organizations)
- Use [[wikilinks]] in the fullArticle and descriptions to cross-reference concepts and entities by their slug
- All slugs must be kebab-case, lowercase
- ${focusPrompt}
- Be precise — do not hallucinate connections not supported by the source`;
}

export class IngestService {
  private systemPrompt: string;

  constructor(
    private llm: LLMProvider,
    private search: SearchService,
    private storage: StorageBackend,
    private config: KBConfig
  ) {
    this.systemPrompt = buildIngestSystemPrompt(config.topic, config.focusPrompt);
  }

  /**
   * Compute a SHA-256 hash of raw bytes or a string.
   */
  private computeHash(data: Buffer | string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
   * Check whether this raw input has already been ingested.
   * Returns the existing hash entry if duplicate, or null if new.
   */
  async checkDuplicate(data: Buffer | string): Promise<HashEntry | null> {
    const hash = this.computeHash(data);
    return this.storage.getHashEntry(hash);
  }

  /**
   * Record a successful ingestion in the hash index.
   */
  private async recordHash(data: Buffer | string, slug: string, title: string): Promise<void> {
    const hash = this.computeHash(data);
    await this.storage.setHashEntry(hash, { slug, title, ingestedAt: new Date().toISOString() });
  }

  /**
   * Get the raw input bytes/string from a request for hashing.
   * Uses originalBuffer (raw file bytes) when available, otherwise the content string.
   */
  private getRawInput(request: IngestRequest): Buffer | string {
    return request.originalBuffer ?? request.content;
  }

  /**
   * Process an ingest request from any source type.
   * Set force=true to skip duplicate checking and re-ingest.
   */
  async process(request: IngestRequest, force = false): Promise<IngestResult> {
    console.log(`[ingest] Starting ${request.sourceType} ingestion${request.filename ? `: ${request.filename}` : ''}`);

    // Duplicate check on raw input — before any parsing or LLM work
    const rawInput = this.getRawInput(request);
    if (!force) {
      const existing = await this.checkDuplicate(rawInput);
      if (existing) {
        console.log(`[ingest] Duplicate detected — already ingested as "${existing.title}" (${existing.slug})`);
        throw new DuplicateSourceError(existing.slug, existing.title, existing.ingestedAt);
      }
    }

    const parsed = await this.parseSource(request);
    console.log(`[ingest] Parsed source: "${parsed.title}" (${parsed.content.length} chars)`);

    const result = await this.compile(parsed);

    // Record the raw input hash for future dedup
    await this.recordHash(rawInput, result.sourceSummary.slug, result.sourceSummary.title);

    // Save original source file for later download
    const savedPath = await this.saveOriginalFile(result.sourceSummary.slug, request, parsed);
    if (savedPath) {
      result.sourceSummary.sourceFile = savedPath;
      await this.updateSourceFileFrontmatter(result.sourceSummary.slug, savedPath);
    }

    return result;
  }

  /**
   * Process a file that was dropped into the raw/ directory.
   * Set force=true to skip duplicate checking and re-ingest.
   */
  async processFile(filePath: string, force = false): Promise<IngestResult> {
    const ext = path.extname(filePath).toLowerCase();
    const buffer = await fs.readFile(filePath);
    const filename = path.basename(filePath);

    // Duplicate check on raw file bytes — before any parsing or LLM work
    if (!force) {
      const existing = await this.checkDuplicate(buffer);
      if (existing) {
        console.log(`[ingest] Duplicate detected — already ingested as "${existing.title}" (${existing.slug})`);
        throw new DuplicateSourceError(existing.slug, existing.title, existing.ingestedAt);
      }
    }

    let parsed: ParsedSource;

    if (ext === '.pdf') {
      parsed = await parsePdfBuffer(buffer, filename);
    } else {
      parsed = await parseTextFile(filePath);
    }

    const result = await this.compile(parsed);

    // Record the raw file hash for future dedup
    await this.recordHash(buffer, result.sourceSummary.slug, result.sourceSummary.title);

    // Save original source file for later download
    const savedPath = await this.saveOriginalFile(result.sourceSummary.slug, {
      sourceType: ext === '.pdf' ? 'pdf' : 'text',
      content: '',
      originalBuffer: buffer,
      originalFilename: filename,
    }, parsed);
    if (savedPath) {
      result.sourceSummary.sourceFile = savedPath;
      await this.updateSourceFileFrontmatter(result.sourceSummary.slug, savedPath);
    }

    return result;
  }

  private async parseSource(request: IngestRequest): Promise<ParsedSource> {
    switch (request.sourceType) {
      case 'url':
        return parseUrl(request.content);
      case 'pdf':
        return parsePdfBuffer(Buffer.from(request.content, 'base64'), request.filename);
      case 'text':
        return parseTextContent(request.content, request.title);
    }
  }

  /**
   * Send parsed source to LLM for analysis, then write wiki pages.
   */
  private async compile(source: ParsedSource): Promise<IngestResult> {
    console.log(`[ingest] Sending to LLM (${this.llm.name}/${this.llm.model})...`);
    const startTime = Date.now();

    const prompt = `Analyze the following source material and extract structured wiki content.

Source title: ${source.title}
${source.sourceUrl ? `Source URL: ${source.sourceUrl}` : ''}
${source.authors?.length ? `Authors: ${source.authors.join(', ')}` : ''}

--- SOURCE CONTENT ---
${source.content.slice(0, 30000)}
--- END SOURCE CONTENT ---

Respond with the JSON structure as specified in your instructions.`;

    const result = await this.llm.complete({
      prompt,
      systemPrompt: this.systemPrompt,
      maxTokens: 8192,
      temperature: 0.2,
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[ingest] LLM responded in ${elapsed}s (${result.usage.inputTokens} in / ${result.usage.outputTokens} out)`);

    let parsed: IngestResult;
    try {
      const cleaned = result.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch (e) {
      throw new Error(`LLM returned invalid JSON: ${(e as Error).message}\n\nRaw response:\n${result.content.slice(0, 500)}`);
    }

    // Apply source metadata
    parsed.sourceSummary.sourceUrl = source.sourceUrl ?? parsed.sourceSummary.sourceUrl;
    if (source.authors?.length) parsed.sourceSummary.authors = source.authors;
    parsed.sourceSummary.slug = toKebabCase(parsed.sourceSummary.title);

    console.log(`[ingest] Writing pages: 1 source, ${parsed.concepts.length} concepts, ${parsed.entities.length} entities`);

    // Write all wiki pages
    try {
      await this.writePages(parsed);
    } catch (err) {
      console.error(`[ingest] ERROR writing pages:`, (err as Error).message, (err as Error).stack);
      throw err;
    }

    // Update the master index and log
    try {
      await this.updateIndex(parsed);
      await this.appendLog('ingest', parsed.sourceSummary.title, parsed);
    } catch (err) {
      console.error(`[ingest] ERROR updating index/log:`, (err as Error).message);
      throw err;
    }

    console.log(`[ingest] Done: "${parsed.sourceSummary.title}"`);

    return parsed;
  }

  private async writePages(result: IngestResult): Promise<void> {
    const dateStr = today();
    const pagesForIndexing: Array<{ slug: string; content: string; metadata: Record<string, string> }> = [];

    // Write source summary
    const sourceFm: PageFrontmatter = {
      title: result.sourceSummary.title,
      date_created: dateStr,
      date_modified: dateStr,
      summary: result.sourceSummary.summary.slice(0, 200),
      tags: result.sourceSummary.tags,
      type: 'source',
      status: 'draft',
      source_url: result.sourceSummary.sourceUrl,
      authors: result.sourceSummary.authors,
    };

    const sourceSlug = result.sourceSummary.slug;
    const sourceBody = result.sourceSummary.fullArticle;
    await this.storage.writePage('sources', sourceSlug, buildPageContent(sourceFm, sourceBody));
    pagesForIndexing.push({
      slug: sourceSlug,
      content: result.sourceSummary.fullArticle,
      metadata: { type: 'source', path: `wiki/sources/${sourceSlug}.md`, title: result.sourceSummary.title },
    });

    // Write concept pages
    for (const concept of result.concepts) {
      const exists = await this.storage.pageExists('concepts', concept.slug);

      if (exists) {
        // Append new information to existing concept page
        const appendSection = `\n\n## Additional Context from [[${sourceSlug}]]\n\n${concept.description}`;
        await this.storage.appendToPage('concepts', concept.slug, appendSection);
      } else {
        const conceptFm: PageFrontmatter = {
          title: concept.name,
          date_created: dateStr,
          date_modified: dateStr,
          summary: concept.description.slice(0, 200),
          tags: ['concept'],
          type: 'concept',
          status: 'draft',
          related: concept.relatedConcepts.map((c) => `[[${c}]]`),
          source_count: 1,
          confidence: 'emerging',
        };
        const conceptBody = `${concept.description}\n\n## Sources\n\n- [[${sourceSlug}]]`;
        await this.storage.writePage('concepts', concept.slug, buildPageContent(conceptFm, conceptBody));
      }

      pagesForIndexing.push({
        slug: concept.slug,
        content: concept.description,
        metadata: { type: 'concept', path: `wiki/concepts/${concept.slug}.md`, title: concept.name },
      });
    }

    // Write entity pages
    for (const entity of result.entities) {
      const exists = await this.storage.pageExists('entities', entity.slug);

      if (exists) {
        const appendSection = `\n\n## Additional Context from [[${sourceSlug}]]\n\n${entity.description}`;
        await this.storage.appendToPage('entities', entity.slug, appendSection);
      } else {
        const entityFm: PageFrontmatter = {
          title: entity.name,
          date_created: dateStr,
          date_modified: dateStr,
          summary: entity.description.slice(0, 200),
          tags: [entity.entityType],
          type: 'entity',
          status: 'draft',
        };
        const entityBody = `**Type:** ${entity.entityType}\n\n${entity.description}\n\n## Sources\n\n- [[${sourceSlug}]]`;
        await this.storage.writePage('entities', entity.slug, buildPageContent(entityFm, entityBody));
      }

      pagesForIndexing.push({
        slug: entity.slug,
        content: entity.description,
        metadata: { type: 'entity', path: `wiki/entities/${entity.slug}.md`, title: entity.name },
      });
    }

    // Index all new/updated pages for semantic search
    await this.search.indexPages(pagesForIndexing);
  }

  private async updateIndex(result: IngestResult): Promise<void> {
    let indexContent = await this.storage.readIndex();

    if (!indexContent) {
      indexContent = `---\ntitle: "Wiki Index"\ndate_modified: ${today()}\ntotal_articles: 0\n---\n\n# Wiki Index\n\n## Overview\nPersonal knowledge base on ${this.config.topic}.\n\n## Concepts\n\n## Entities\n\n## Source Summaries\n\n## Recently Added\n`;
    }

    // Add new entries under the correct sections
    const sourceEntry = `- [[${result.sourceSummary.slug}]] — ${result.sourceSummary.summary.slice(0, 80)}\n`;
    indexContent = insertUnderSection(indexContent, '## Source Summaries', sourceEntry);

    for (const concept of result.concepts) {
      const entry = `- [[${concept.slug}]] — ${concept.description.slice(0, 80)}\n`;
      indexContent = insertUnderSection(indexContent, '## Concepts', entry);
    }

    for (const entity of result.entities) {
      const entry = `- [[${entity.slug}]] — ${entity.description.slice(0, 80)}\n`;
      indexContent = insertUnderSection(indexContent, '## Entities', entry);
    }

    // Update recently added
    const recentEntry = `1. [${today()}] [[${result.sourceSummary.slug}]] (source)\n`;
    indexContent = insertUnderSection(indexContent, '## Recently Added', recentEntry);

    // Update date_modified in frontmatter
    indexContent = indexContent.replace(/date_modified: .+/, `date_modified: ${today()}`);

    await this.storage.writeIndex(indexContent);
  }

  private async saveOriginalFile(
    slug: string,
    request: IngestRequest,
    parsed: ParsedSource
  ): Promise<string | null> {
    let filename: string;
    let buffer: Buffer;

    if (request.originalBuffer && request.originalFilename) {
      filename = request.originalFilename;
      buffer = request.originalBuffer;
    } else if (request.sourceType === 'url' && parsed.rawContent) {
      filename = 'source.html';
      buffer = Buffer.from(parsed.rawContent, 'utf-8');
    } else if (request.sourceType === 'text') {
      filename = 'source.txt';
      buffer = Buffer.from(request.content, 'utf-8');
    } else {
      return null;
    }

    await this.storage.saveUpload(slug, filename, buffer);
    console.log(`[ingest] Saved original file: uploads/${slug}/${filename}`);
    return `${slug}/${filename}`;
  }

  private async updateSourceFileFrontmatter(slug: string, sourceFile: string): Promise<void> {
    const raw = await this.storage.readPage('sources', slug);
    if (!raw) return;

    // Insert source_file before the closing --- of frontmatter
    const updated = raw.replace(
      /^(---\n[\s\S]*?)(---)/m,
      (match, front, close) => {
        if (front.includes('source_file:')) return match;
        return `${front}source_file: "${sourceFile}"\n${close}`;
      }
    );
    await this.storage.writePage('sources', slug, updated);
  }

  private async appendLog(
    operation: string,
    title: string,
    result: IngestResult
  ): Promise<void> {
    let logContent = await this.storage.readLog();

    const details = [
      `- Created: wiki/sources/${result.sourceSummary.slug}.md`,
      ...result.concepts.map((c) => `- Created/Updated: wiki/concepts/${c.slug}.md`),
      ...result.entities.map((e) => `- Created/Updated: wiki/entities/${e.slug}.md`),
    ];

    const entry = `\n## [${today()}] ${operation} | ${title}\n${details.join('\n')}\n`;
    logContent += entry;

    await this.storage.writeLog(logContent);
  }
}

function insertUnderSection(content: string, sectionHeader: string, entry: string): string {
  const idx = content.indexOf(sectionHeader);
  if (idx === -1) {
    return content + `\n${sectionHeader}\n${entry}`;
  }
  const insertPos = idx + sectionHeader.length + 1; // +1 for newline
  return content.slice(0, insertPos) + entry + content.slice(insertPos);
}

export class DuplicateSourceError extends Error {
  constructor(
    public readonly existingSlug: string,
    public readonly existingTitle: string,
    public readonly ingestedAt: string
  ) {
    super(`Duplicate source: already ingested as "${existingTitle}" (${existingSlug})`);
    this.name = 'DuplicateSourceError';
  }
}
