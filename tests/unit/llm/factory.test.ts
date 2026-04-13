import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLLMProvider, createProviderFromEnv } from '../../../src/core/llm/factory.js';
import { ClaudeProvider } from '../../../src/core/llm/claude.js';
import { OpenAIProvider } from '../../../src/core/llm/openai.js';

describe('createLLMProvider', () => {
  it('creates a Claude provider', () => {
    const provider = createLLMProvider({ provider: 'claude', apiKey: 'test-key' });
    expect(provider).toBeInstanceOf(ClaudeProvider);
    expect(provider.name).toBe('claude');
  });

  it('creates an OpenAI provider', () => {
    const provider = createLLMProvider({ provider: 'openai', apiKey: 'test-key' });
    expect(provider).toBeInstanceOf(OpenAIProvider);
    expect(provider.name).toBe('openai');
  });

  it('passes custom model to Claude provider', () => {
    const provider = createLLMProvider({ provider: 'claude', apiKey: 'test-key', model: 'claude-opus-4-20250514' });
    expect(provider.model).toBe('claude-opus-4-20250514');
  });

  it('passes custom model to OpenAI provider', () => {
    const provider = createLLMProvider({ provider: 'openai', apiKey: 'test-key', model: 'gpt-4-turbo' });
    expect(provider.model).toBe('gpt-4-turbo');
  });

  it('throws on unknown provider', () => {
    expect(() => createLLMProvider({ provider: 'unknown' as never, apiKey: 'test' })).toThrow(
      'Unknown LLM provider: unknown'
    );
  });
});

describe('createProviderFromEnv', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('creates Claude provider from env', () => {
    process.env.LLM_PROVIDER = 'claude';
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    const provider = createProviderFromEnv();
    expect(provider).toBeInstanceOf(ClaudeProvider);
  });

  it('creates OpenAI provider from env', () => {
    process.env.LLM_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'test-openai-key';
    const provider = createProviderFromEnv();
    expect(provider).toBeInstanceOf(OpenAIProvider);
  });

  it('returns null if Claude API key is missing', () => {
    process.env.LLM_PROVIDER = 'claude';
    delete process.env.ANTHROPIC_API_KEY;
    expect(createProviderFromEnv()).toBeNull();
  });

  it('returns null if OpenAI API key is missing', () => {
    process.env.LLM_PROVIDER = 'openai';
    delete process.env.OPENAI_API_KEY;
    expect(createProviderFromEnv()).toBeNull();
  });

  it('defaults to Claude when LLM_PROVIDER is not set', () => {
    delete process.env.LLM_PROVIDER;
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const provider = createProviderFromEnv();
    expect(provider).toBeInstanceOf(ClaudeProvider);
  });
});
