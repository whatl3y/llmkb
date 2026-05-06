import crypto from 'crypto';
import matter from 'gray-matter';
import type { LLMProvider, KBConfig, KBOverview, OverviewHighlight } from '../types/index.js';
import type { StorageBackend } from './storage/types.js';

const META_KEY = 'homepage-overview';
const DEBOUNCE_MS = 60_000;
const MIN_PAGES = 10;
const SAMPLE_LIMIT = 60;
const TYPE_DIRS = ['concepts', 'entities', 'sources', 'syntheses', 'outputs'] as const;

interface PageMeta {
  type: string;
  slug: string;
  title: string;
  summary: string;
  tags: string[];
  date_modified: string;
}

/**
 * Generates and caches the homepage overview — a short LLM-summarized
 * description of what the KB currently covers, plus 3–5 representative
 * highlights. Regeneration is debounced after wiki writes so a batch of
 * ingests only triggers one LLM pass.
 */
export class OverviewService {
  private debounceTimer: NodeJS.Timeout | null = null;
  private regenInProgress = false;
  private redoAfterRegen = false;

  constructor(
    private llm: LLMProvider,
    private storage: StorageBackend,
    private config: KBConfig,
  ) {}

  async getOverview(): Promise<KBOverview | null> {
    return await this.storage.getMeta<KBOverview>(META_KEY);
  }

  /** Schedule a debounced regeneration. Safe to call repeatedly. */
  markStale(): void {
    if (this.regenInProgress) {
      this.redoAfterRegen = true;
      return;
    }
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.regenerate().catch((err) => {
        console.error('[overview] regen failed:', (err as Error).message);
      });
    }, DEBOUNCE_MS);
    if (typeof this.debounceTimer.unref === 'function') this.debounceTimer.unref();
  }

  /** Force a regeneration now, bypassing the debounce. */
  async regenerate(): Promise<KBOverview | null> {
    if (this.regenInProgress) {
      this.redoAfterRegen = true;
      return null;
    }
    this.regenInProgress = true;
    try {
      return await this.runRegeneration();
    } finally {
      this.regenInProgress = false;
      if (this.redoAfterRegen) {
        this.redoAfterRegen = false;
        this.markStale();
      }
    }
  }

  private async runRegeneration(): Promise<KBOverview | null> {
    const sample = await this.collectSample();
    const pageCount = sample.totalPages;

    if (pageCount < MIN_PAGES) {
      console.log(`[overview] Skipping regen — ${pageCount} pages, need ${MIN_PAGES}`);
      return null;
    }

    const sourceVersion = this.computeVersion(sample.pages, pageCount);
    const existing = await this.getOverview();
    if (existing?.sourceVersion === sourceVersion) {
      console.log('[overview] Source unchanged, skipping regen');
      return existing;
    }

    console.log(`[overview] Regenerating (${pageCount} pages, model=${this.llm.name}/${this.llm.model})...`);
    const start = Date.now();

    const generated = await this.callLLM(sample.pages, pageCount);
    if (!generated) return null;

    const validSlugs = new Set(sample.pages.map((p) => `${p.type}/${p.slug}`));
    const filteredHighlights = generated.highlights.filter((h) =>
      validSlugs.has(`${h.type}/${h.slug}`),
    );

    if (filteredHighlights.length === 0) {
      console.warn('[overview] LLM returned no valid highlights, dropping regen');
      return null;
    }

    const record: KBOverview = {
      topic: generated.topic,
      description: generated.description,
      highlights: filteredHighlights,
      generatedAt: new Date().toISOString(),
      pageCountAtGeneration: pageCount,
      sourceVersion,
    };
    await this.storage.setMeta(META_KEY, record);

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[overview] Generated in ${elapsed}s — ${filteredHighlights.length} highlights`);
    return record;
  }

  private async collectSample(): Promise<{ pages: PageMeta[]; totalPages: number }> {
    const all = await this.storage.listAllPagesWithContent();
    const parsed: PageMeta[] = [];

    for (const { type, slug, raw } of all) {
      if (!TYPE_DIRS.includes(type as (typeof TYPE_DIRS)[number])) continue;
      try {
        const { data } = matter(raw);
        parsed.push({
          type,
          slug,
          title: typeof data.title === 'string' ? data.title : slug,
          summary: typeof data.summary === 'string' ? data.summary : '',
          tags: Array.isArray(data.tags) ? (data.tags as string[]) : [],
          date_modified: typeof data.date_modified === 'string' ? data.date_modified : '',
        });
      } catch {
        // skip malformed
      }
    }

    parsed.sort((a, b) => (b.date_modified || '').localeCompare(a.date_modified || ''));
    return { pages: parsed.slice(0, SAMPLE_LIMIT), totalPages: parsed.length };
  }

  private computeVersion(pages: PageMeta[], totalPages: number): string {
    const fingerprint = pages
      .map((p) => `${p.type}/${p.slug}@${p.date_modified}`)
      .sort()
      .join('|');
    return crypto
      .createHash('sha256')
      .update(`${totalPages}:${fingerprint}`)
      .digest('hex')
      .slice(0, 16);
  }

  private async callLLM(
    pages: PageMeta[],
    totalPages: number,
  ): Promise<Pick<KBOverview, 'topic' | 'description' | 'highlights'> | null> {
    const sampleLines = pages
      .map((p) => {
        const tagList = p.tags.length > 0 ? ` [tags: ${p.tags.slice(0, 4).join(', ')}]` : '';
        const summary = p.summary ? `: ${p.summary}` : '';
        return `- ${p.type}/${p.slug} — ${p.title}${summary}${tagList}`;
      })
      .join('\n');

    const systemPrompt =
      'You write concise, accurate homepage summaries for personal knowledge bases. Respond with valid JSON only — no markdown fences, no commentary.';

    const prompt = `A user-maintained knowledge base currently contains ${totalPages} pages.

The user-defined intent (anchor — keep your output consistent with this):
- name: ${this.config.name}
- topic: ${this.config.topic}
- description: ${this.config.description}

Below is a sample of the most recently modified pages (up to ${SAMPLE_LIMIT}), each line listing "type/slug — title: summary [tags]". Use these to ground your output in what the KB ACTUALLY contains right now.

--- PAGES ---
${sampleLines}
--- END PAGES ---

Return JSON with exactly this shape:
{
  "topic": "string — 3 to 8 words capturing what this KB is about (may refine the user-defined topic if the corpus has drifted)",
  "description": "string — 1 to 2 sentences (~25 to 50 words) describing what the KB covers, grounded in the pages above",
  "highlights": [
    {
      "title": "string — title from a page above",
      "summary": "string — one short sentence about what this page covers",
      "type": "concepts | entities | sources | syntheses | outputs",
      "slug": "string — exact kebab-case slug from the page above"
    }
  ]
}

Rules:
- "highlights" must contain 3 to 5 items.
- Each highlight MUST be a real page that appears in the list above — do not invent slugs or types.
- Favor variety across types (a mix of concepts/sources/syntheses) over five of the same type.
- Pick highlights that best represent the breadth of the KB, not the most recently added.
- Keep all output grounded in the page list — do not speculate beyond it.`;

    const result = await this.llm.complete({
      prompt,
      systemPrompt,
      maxTokens: 2048,
      temperature: 0.2,
    });

    try {
      const cleaned = result.content
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();
      const parsed = JSON.parse(cleaned);

      if (!parsed.topic || !parsed.description || !Array.isArray(parsed.highlights)) {
        throw new Error('missing required fields');
      }

      const rawHighlights = parsed.highlights as unknown[];
      const highlights: OverviewHighlight[] = rawHighlights
        .filter((h): h is Record<string, unknown> => !!h && typeof h === 'object')
        .filter((h: Record<string, unknown>) => typeof h.slug === 'string' && typeof h.type === 'string')
        .slice(0, 5)
        .map((h: Record<string, unknown>) => ({
          title: typeof h.title === 'string' ? h.title : String(h.slug),
          summary: typeof h.summary === 'string' ? h.summary : '',
          type: String(h.type),
          slug: String(h.slug),
        }));

      return {
        topic: String(parsed.topic),
        description: String(parsed.description),
        highlights,
      };
    } catch (e) {
      console.error('[overview] LLM returned invalid JSON:', (e as Error).message);
      console.error('[overview] Raw response:', result.content.slice(0, 500));
      return null;
    }
  }
}
