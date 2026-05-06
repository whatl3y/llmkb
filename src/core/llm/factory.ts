import type { LLMProvider } from '../../types/index.js';
import { ClaudeProvider } from './claude.js';
import { OpenAIProvider } from './openai.js';

export type ProviderName = 'claude' | 'openai';

export interface ProviderConfig {
  provider: ProviderName;
  apiKey: string;
  model?: string;
}

export function createLLMProvider(config: ProviderConfig): LLMProvider {
  switch (config.provider) {
    case 'claude':
      return new ClaudeProvider(config.apiKey, config.model);
    case 'openai':
      return new OpenAIProvider(config.apiKey, config.model);
    default:
      throw new Error(`Unknown LLM provider: ${config.provider}`);
  }
}

export function createProviderFromEnv(): LLMProvider | null {
  const provider = (process.env.LLM_PROVIDER ?? 'claude') as ProviderName;

  if (provider === 'claude') {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.warn('[llm] ANTHROPIC_API_KEY not set — LLM features (ingest, query) will be unavailable');
      return null;
    }
    return new ClaudeProvider(apiKey, process.env.CLAUDE_MODEL);
  }

  if (provider === 'openai') {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.warn('[llm] OPENAI_API_KEY not set — LLM features (ingest, query) will be unavailable');
      return null;
    }
    return new OpenAIProvider(apiKey, process.env.OPENAI_MODEL);
  }

  throw new Error(`Unknown LLM_PROVIDER: ${provider}`);
}

/**
 * Cheaper companion provider used for short utility passes (e.g. homepage
 * overview regen) that run frequently. Returns null when no API key is set.
 */
export function createOverviewProviderFromEnv(): LLMProvider | null {
  const provider = (process.env.LLM_PROVIDER ?? 'claude') as ProviderName;

  if (provider === 'claude') {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return null;
    const model = process.env.CLAUDE_OVERVIEW_MODEL || 'claude-haiku-4-5-20251001';
    return new ClaudeProvider(apiKey, model);
  }

  if (provider === 'openai') {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return null;
    const model = process.env.OPENAI_OVERVIEW_MODEL || 'gpt-4o-mini';
    return new OpenAIProvider(apiKey, model);
  }

  throw new Error(`Unknown LLM_PROVIDER: ${provider}`);
}
