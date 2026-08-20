import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiTask } from './ai.types';
import {
  AiProvider,
  AiCompletionResult,
  AiMessage,
  AiToolDefinition,
} from './providers/ai-provider.interface';
import { OpenAiCompatibleProvider } from './providers/openai-compatible.provider';
import { OllamaProvider } from './providers/ollama.provider';

interface Route {
  provider: string;
  model: string;
}

/**
 * Routes each AiTask tier to a provider + model.
 *
 * Ollama is the default because the agent reads production commercial data and
 * the on-prem model keeps it inside the network. Cloud providers register only
 * when their key is present, and a single `AI_ROUTE_<TIER>=provider:model`
 * env var moves a tier to one of them without any tool or prompt changing.
 */
@Injectable()
export class AiRouterService implements OnModuleInit {
  private readonly logger = new Logger(AiRouterService.name);
  private readonly providers = new Map<string, AiProvider>();
  private readonly routes = new Map<AiTask, Route>();

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    this.providers.set(
      'ollama',
      new OllamaProvider('ollama', this.config.get<string>('OLLAMA_BASE_URL', 'http://localhost:11434')),
    );

    this.registerKeyedProvider(
      'xai',
      this.config.get<string>('XAI_BASE_URL', 'https://api.x.ai/v1'),
      this.config.get<string>('XAI_API_KEY'),
    );
    this.registerKeyedProvider(
      'openai',
      this.config.get<string>('OPENAI_BASE_URL', 'https://api.openai.com/v1'),
      this.config.get<string>('OPENAI_API_KEY'),
    );
    this.registerKeyedProvider(
      'gemini',
      this.config.get<string>(
        'GEMINI_BASE_URL',
        'https://generativelanguage.googleapis.com/v1beta/openai',
      ),
      this.config.get<string>('GEMINI_API_KEY'),
    );

    // Local defaults. Every tier needs a model that supports tool calling —
    // the agents are useless without it — which rules out plain instruct
    // builds like mistral:7b.
    this.configureRoute(AiTask.FAST, 'ollama', 'qwen2.5:7b');
    this.configureRoute(AiTask.BALANCED, 'ollama', 'qwen2.5:14b');
    this.configureRoute(AiTask.REASONING, 'ollama', 'qwen2.5:32b');

    this.logger.log(
      `AI routes: ${[...this.routes.entries()]
        .map(([task, route]) => `${task}→${route.provider}:${route.model}`)
        .join(', ')}`,
    );
  }

  private registerKeyedProvider(name: string, baseUrl: string, apiKey: string | undefined) {
    if (!apiKey) return;
    this.providers.set(name, new OpenAiCompatibleProvider(name, baseUrl, apiKey));
  }

  private configureRoute(task: AiTask, preferredProvider: string, defaultModel: string) {
    const tier = task.toUpperCase();
    const [overrideProvider, overrideModel] =
      this.config.get<string>(`AI_ROUTE_${tier}`)?.split(':') ?? [];

    if (overrideProvider && !this.providers.has(overrideProvider)) {
      this.logger.warn(
        `AI_ROUTE_${tier} names provider "${overrideProvider}", which has no API key configured — falling back to ${preferredProvider}.`,
      );
    }

    const provider =
      (overrideProvider && this.providers.has(overrideProvider) && overrideProvider) ||
      preferredProvider;

    this.routes.set(task, {
      provider,
      model: overrideModel || this.config.get<string>(`AI_MODEL_${tier}`, defaultModel),
    });
  }

  async complete(
    task: AiTask,
    messages: AiMessage[],
    options?: {
      tools?: AiToolDefinition[];
      temperature?: number;
      maxTokens?: number;
      jsonMode?: boolean;
    },
  ): Promise<AiCompletionResult> {
    const route = this.routes.get(task);
    if (!route) throw new Error(`No AI route configured for task "${task}".`);

    const provider = this.providers.get(route.provider);
    if (!provider) throw new Error(`AI provider "${route.provider}" is not registered.`);

    return provider.complete({
      model: route.model,
      messages,
      tools: options?.tools,
      temperature: options?.temperature,
      maxTokens: options?.maxTokens,
      jsonMode: options?.jsonMode,
    });
  }
}
