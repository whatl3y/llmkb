import type { LLMProvider } from '../types/index.js';

export interface IntentResult {
  intent: 'browse' | 'search' | 'query' | 'ingest_url' | 'ingest_text';
  params: Record<string, unknown>;
}

const SYSTEM_PROMPT = `You classify user input for a knowledge base application into one of these intents:

- "browse": User wants to see wiki pages, optionally filtered to a topic. Return params: { "type": "all" | "concepts" | "entities" | "sources" | "syntheses" | "outputs", "topic": "specific topic/keyword to filter by, or empty string for no filter" }
- "search": User wants a quick compact list of matching pages. Return params: { "query": "search terms" }
- "query": User asks a question that needs a synthesized answer. Return params: { "question": "the full question exactly as the user wrote it" }
- "ingest_url": User provided a URL to add to the knowledge base. Return params: { "url": "the URL" }
- "ingest_text": User wants to add/save text content to the knowledge base. Return params: { "content": "the text", "title": "optional title or empty string" }

Critical rules:
- "browse" is for listing/viewing pages. Use it when the user wants to see pages — with or without a topic filter. "show all concepts" → browse type=concepts topic="". "what documents about patterndesk?" → browse type=all topic="patterndesk". "list sources for RAG" → browse type=sources topic="RAG"
- "search" is for quick keyword lookups that want a compact result list. "find X", "search for X" → search
- "what do you have about X?", "documents about X", "anything on X?" → "browse" with topic (user wants to see matching pages, not a synthesized answer)
- Questions seeking explanations or synthesis ("how does X work?", "what is X?", "explain X", "compare X and Y") → "query"
- Input that is just a URL or contains a URL with add/ingest context → "ingest_url"
- Explicit requests to add/save/ingest text content → "ingest_text"
- When uncertain between search and query: prefer "query" for questions, "search" for requests to list/find matching content
- For the "query" params.question field, pass through the user's full original input — do not rephrase or summarize it

Respond with JSON only — no markdown fences, no commentary:
{ "intent": "...", "params": { ... } }`;

export class IntentService {
  constructor(private llm: LLMProvider) {}

  async classify(input: string): Promise<IntentResult> {
    // Quick heuristic: bare URL → ingest
    const trimmed = input.trim();
    if (/^https?:\/\/\S+$/i.test(trimmed)) {
      return { intent: 'ingest_url', params: { url: trimmed } };
    }

    // LLM classification
    const result = await this.llm.complete({
      prompt: input,
      systemPrompt: SYSTEM_PROMPT,
      maxTokens: 256,
      temperature: 0.1,
    });

    try {
      const cleaned = result.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(cleaned);
      return {
        intent: parsed.intent,
        params: parsed.params ?? {},
      };
    } catch {
      // Fallback: treat as query
      return { intent: 'query', params: { question: input } };
    }
  }
}
