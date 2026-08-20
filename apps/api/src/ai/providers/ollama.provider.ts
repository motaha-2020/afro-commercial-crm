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
 * Ollama running on Afro's own server — nothing leaves the network.
 *
 * Its `/api/chat` endpoint is close to but not the OpenAI wire format: tool
 * calls carry no id (so we mint one to keep the request/result pairing that
 * the rest of the code relies on) and arguments arrive as a parsed object
 * rather than a JSON string.
 */
export class OllamaProvider implements AiProvider {
  private readonly logger = new Logger(OllamaProvider.name);

  constructor(
    readonly name: string,
    private readonly baseUrl: string,
  ) {}

  async complete(request: AiCompletionRequest): Promise<AiCompletionResult> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: request.model,
          messages: request.messages.map(toWireMessage),
          ...(request.tools?.length ? { tools: request.tools.map(toWireTool) } : {}),
          stream: false,
          ...(request.jsonMode ? { format: 'json' } : {}),
          options: {
            temperature: request.temperature ?? 0.3,
            ...(request.maxTokens ? { num_predict: request.maxTokens } : {}),
          },
        }),
      });
    } catch (cause) {
      throw new AiProviderError(this.name, undefined, cause);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      this.logger.error(`${this.name} completion failed (${response.status}): ${body.slice(0, 500)}`);
      throw new AiProviderError(this.name, response.status, body);
    }

    const data = await response.json();
    const message = data?.message;

    return {
      content: message?.content ?? '',
      toolCalls: message?.tool_calls?.length
        ? message.tool_calls.map((call: any, index: number) => ({
            id: `${data?.created_at ?? 'call'}-${index}`,
            name: call.function?.name,
            arguments:
              typeof call.function?.arguments === 'string'
                ? call.function.arguments
                : JSON.stringify(call.function?.arguments ?? {}),
          }))
        : undefined,
      provider: this.name,
      model: request.model,
      usage: {
        promptTokens: data?.prompt_eval_count,
        completionTokens: data?.eval_count,
      },
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
    return { role: 'tool', content: message.content };
  }

  if (message.toolCalls?.length) {
    return {
      role: message.role,
      content: message.content ?? '',
      tool_calls: message.toolCalls.map((call) => ({
        function: { name: call.name, arguments: safeParse(call.arguments) },
      })),
    };
  }

  return { role: message.role, content: message.content };
}

function safeParse(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}
