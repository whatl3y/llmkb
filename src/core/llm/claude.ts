import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider, CompletionParams, CompletionResult } from '../../types/index.js';

export class ClaudeProvider implements LLMProvider {
  readonly name = 'claude';
  readonly model: string;
  private client: Anthropic;

  constructor(apiKey: string, model = 'claude-sonnet-4-20250514') {
    this.model = model;
    this.client = new Anthropic({ apiKey });
  }

  async complete(params: CompletionParams): Promise<CompletionResult> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: params.maxTokens ?? 4096,
      temperature: params.temperature ?? 0.3,
      system: params.systemPrompt ?? '',
      messages: [{ role: 'user', content: params.prompt }],
    });

    const textBlock = response.content.find((block) => block.type === 'text');
    return {
      content: textBlock?.text ?? '',
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }

  async *stream(params: CompletionParams): AsyncIterable<string> {
    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: params.maxTokens ?? 4096,
      temperature: params.temperature ?? 0.3,
      system: params.systemPrompt ?? '',
      messages: [{ role: 'user', content: params.prompt }],
    });

    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        yield event.delta.text;
      }
    }
  }
}
