import type { LLMProvider, QueryResult, PageFrontmatter, KBConfig, SearchResult } from '../types/index.js';
import { SearchService } from './search.js';
import { extractKeywords, keywordSearch, mergeResults } from './keyword-search.js';
import { buildPageContent, toKebabCase, today } from '../utils/frontmatter.js';
import type { StorageBackend } from './storage/types.js';

function buildQuerySystemPrompt(topic: string): string {
  return `You are a research assistant for a personal knowledge base about "${topic}."

You will be given a question and relevant wiki pages as context.
Synthesize an answer using ONLY the information in the provided wiki pages.

You MUST respond with valid JSON only — no markdown fences, no commentary.

{
  "answer": "string — A thorough markdown-formatted answer (500-1500 words). Use [[wikilinks]] to reference wiki pages by their slug. Cite specific pages when making claims.",
  "citations": [
    {
      "page": "string — the slug of the cited wiki page",
      "excerpt": "string — a brief quote or paraphrase from that page supporting the claim"
    }
  ]
}

Rules:
- Only cite pages that were provided to you as context
- If the provided context doesn't contain enough information to answer, say so clearly
- Use [[wikilinks]] in the answer to reference concepts and entities
- Structure the answer with markdown headings if the answer is complex
- Be precise and factual — do not add information not in the provided context`;
}

function buildStreamingSystemPrompt(topic: string): string {
  return `You are a research assistant for a personal knowledge base about "${topic}."

You will be given a question and relevant wiki pages as context.
Answer using ONLY the information in the provided wiki pages. Do NOT use outside knowledge.

Rules:
- Use the provided wiki pages as your ONLY source of information
- Reference wiki pages with [[page-slug]] wikilinks
- If the provided pages do not contain enough information to answer the question, say so clearly — do NOT guess or fill in from general knowledge
- Write in clear markdown format — use headings for complex answers
- Be thorough but concise
- Cite specific pages when making claims`;
}

export class QueryService {
  private systemPrompt: string;

  constructor(
    private llm: LLMProvider,
    private search: SearchService,
    private storage: StorageBackend,
    private config: KBConfig
  ) {
    this.systemPrompt = buildQuerySystemPrompt(config.topic);
  }

  /**
   * Retrieve relevant wiki pages by combining vector search and keyword search,
   * then read their full content. This ensures proper nouns and product names
   * are found even when embedding similarity misses them.
   */
  private async retrievePages(question: string): Promise<string[]> {
    const keywords = extractKeywords(question);

    // Run vector search and keyword search in parallel
    const [vectorResults, kwResults] = await Promise.all([
      this.search.search(question, 8).catch(() => [] as SearchResult[]),
      keywordSearch(this.storage, keywords),
    ]);

    // Merge and deduplicate, keyword matches first (more precise for proper nouns)
    const top = mergeResults(kwResults, vectorResults, 12);

    // Read full content for each page
    const pageContents: string[] = [];
    for (const result of top) {
      // result.page is like "wiki/concepts/foo.md" — extract type and slug
      const match = result.page.match(/^wiki\/(\w+)\/(.+)\.md$/);
      if (!match) continue;
      const [, type, slug] = match;

      const content = await this.storage.readPage(type, slug);
      if (content) {
        pageContents.push(`--- PAGE: ${result.slug} (${result.page}) ---\n${content}\n--- END PAGE ---`);
      }
    }

    return pageContents;
  }

  async query(question: string): Promise<QueryResult> {
    const pageContents = await this.retrievePages(question);

    if (pageContents.length === 0) {
      return {
        answer: 'No relevant wiki pages found for this question. Try adding more source material to the knowledge base first.',
        citations: [],
        slug: toKebabCase(question).slice(0, 60),
      };
    }

    // Also read the index for context
    const indexContent = await this.storage.readIndex();

    const prompt = `Question: ${question}

Here is the wiki index for overall context:
${indexContent.slice(0, 3000)}

Here are the relevant wiki pages:

${pageContents.join('\n\n')}

Synthesize a comprehensive answer to the question using the provided wiki pages. Respond with JSON as specified.`;

    const result = await this.llm.complete({
      prompt,
      systemPrompt: this.systemPrompt,
      maxTokens: 4096,
      temperature: 0.3,
    });

    let parsed: { answer: string; citations: Array<{ page: string; excerpt: string }> };
    try {
      const cleaned = result.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      // If JSON parsing fails, use the raw response as the answer
      parsed = { answer: result.content, citations: [] };
    }

    const slug = toKebabCase(question).slice(0, 60);

    // Save the answer as an output page
    await this.saveOutput(slug, question, parsed.answer, parsed.citations);

    return {
      answer: parsed.answer,
      citations: parsed.citations,
      slug,
    };
  }

  async prepareQuery(question: string): Promise<{
    prompt: string;
    systemPrompt: string;
    slug: string;
  }> {
    const slug = toKebabCase(question).slice(0, 60);

    const pageContents = await this.retrievePages(question);

    let prompt: string;
    if (pageContents.length > 0) {
      const indexContent = await this.storage.readIndex();

      prompt = `Question: ${question}

Here is the wiki index for overall context:
${indexContent.slice(0, 3000)}

Here are the relevant wiki pages:

${pageContents.join('\n\n')}

Answer the question using ONLY the provided wiki pages.`;
    } else {
      prompt = `Question: ${question}

No relevant wiki pages were found for this question. Let the user know that no matching content exists in the knowledge base and suggest they add relevant sources.`;
    }

    return {
      prompt,
      systemPrompt: buildStreamingSystemPrompt(this.config.topic),
      slug,
    };
  }

  async saveOutput(
    slug: string,
    question: string,
    answer: string,
    citations: Array<{ page: string; excerpt: string }>
  ): Promise<void> {
    const fm: PageFrontmatter = {
      title: question,
      date_created: today(),
      date_modified: today(),
      summary: answer.slice(0, 200),
      tags: ['query'],
      type: 'output',
      status: 'final',
    };

    const citationList = citations.map((c) => `- [[${c.page}]]: ${c.excerpt}`).join('\n');
    const body = `# ${question}\n\n${answer}\n\n## Citations\n\n${citationList}`;

    await this.storage.writePage('outputs', slug, buildPageContent(fm, body));

    // Index the output for future searches
    await this.search.indexPage(slug, answer, {
      type: 'output',
      path: `wiki/outputs/${slug}.md`,
      title: question,
    });

    // Update log
    let log = await this.storage.readLog();
    log += `\n## [${today()}] query | ${question}\n- Filed: wiki/outputs/${slug}.md\n`;
    await this.storage.writeLog(log);
  }
}
