import { Logger } from '@nestjs/common';
import { AiProviderError } from '../errors/provider-error';
import {
  AiCompletionRequest,
  AiCompletionResult,
  AiMessage,
  AiProvider,
  AiToolDefinition,
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
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: request.model,
          messages: request.messages.map(toWireMessage),
          ...(request.tools?.length ? { tools: request.tools.map(toWireTool) } : {}),
          temperature: request.temperature ?? 0.3,
          max_tokens: request.maxTokens,
          ...(request.jsonMode ? { response_format: { type: 'json_object' } } : {}),
        }),
      });
    } catch (cause) {
      throw new AiProviderError(this.name, undefined, cause);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      this.logger.error(
        `${this.name} completion failed (${response.status}): ${body.slice(0, 500)}`,
      );
      // The body travels with the throw: the classifier needs the provider's
      // own words, and the wrapper's phrasing alone hides which 429 this is.
      throw new AiProviderError(this.name, response.status, parseMaybeJson(body));
    }

    const data = await response.json();
    const message = data?.choices?.[0]?.message;

    return {
      content: message?.content ?? '',
      toolCalls: message?.tool_calls?.length
        ? message.tool_calls.map((call: any) => ({
            id: call.id,
            name: call.function?.name,
            arguments: call.function?.arguments ?? '{}',
          }))
        : undefined,
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

function toWireTool(tool: AiToolDefinition) {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

function toWireMessage(message: AiMessage) {
  if (message.role === 'tool') {
    return {
      role: 'tool',
      tool_call_id: message.toolCallId,
      content: message.content,
    };
  }

  if (message.toolCalls?.length) {
    return {
      role: message.role,
      content: message.content || null,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: call.arguments },
      })),
    };
  }

  return { role: message.role, content: message.content };
}

function parseMaybeJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}
