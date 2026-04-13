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

export function createProviderFromEnv(): LLMProvider {
  const provider = (process.env.LLM_PROVIDER ?? 'claude') as ProviderName;

  if (provider === 'claude') {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is required when LLM_PROVIDER=claude');
    return new ClaudeProvider(apiKey, process.env.CLAUDE_MODEL);
  }

  if (provider === 'openai') {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY is required when LLM_PROVIDER=openai');
    return new OpenAIProvider(apiKey, process.env.OPENAI_MODEL);
  }

  throw new Error(`Unknown LLM_PROVIDER: ${provider}`);
}
