import { Logger } from '@nestjs/common';
import {
  AiCompletionRequest,
  AiCompletionResult,
  AiProvider,
} from './ai-provider.interface';

/**
 * Works for any provider that speaks the OpenAI Chat Completions wire format:
 * xAI (Grok), OpenAI, and Gemini's OpenAI-compatibility endpoint.
 */
export class OpenAiCompatibleProvider implements AiProvider {
  private readonly logger = new Logger(OpenAiCompatibleProvider.name);

  constructor(
    readonly name: string,
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  async complete(request: AiCompletionRequest): Promise<AiCompletionResult> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        temperature: request.temperature ?? 0.3,
        max_tokens: request.maxTokens,
        ...(request.jsonMode ? { response_format: { type: 'json_object' } } : {}),
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      this.logger.error(
        `${this.name} completion failed (${response.status}): ${body.slice(0, 500)}`,
      );
      throw new Error(`AI provider "${this.name}" request failed with status ${response.status}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content ?? '';

    return {
      content,
      provider: this.name,
      model: request.model,
      usage: data?.usage
        ? {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
            totalTokens: data.usage.total_tokens,
          }
        : undefined,
    };
  }
}
