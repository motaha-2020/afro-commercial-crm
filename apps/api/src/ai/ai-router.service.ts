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
 * OpenAI is the default, so by default the questions people ask — and the
 * opportunity codes, values and margins the tools hand back to answer them —
 * leave the network. That is a data-residency decision, not a performance one,
 * and it is written here rather than left to a deployment to discover.
 *
 * Ollama runs on the same host and keeps everything inside the network. It is
 * always registered and needs no key, so `AI_ROUTE_<TIER>=ollama:qwen2.5:14b`
 * — or `AI_DEFAULT_PROVIDER=ollama` for all three tiers — moves a tier back
 * on-prem without a single tool or prompt changing.
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

    // One switch for the whole stack: AI_DEFAULT_PROVIDER=ollama puts every
    // tier back on-prem without naming a model for each.
    const preferred = this.config.get<string>('AI_DEFAULT_PROVIDER', 'openai');

    // Every tier needs a model that supports tool calling — the agents are
    // useless without it — which rules out plain instruct builds.
    this.configureRoute(AiTask.FAST, preferred, { openai: 'gpt-4o-mini', ollama: 'qwen2.5:7b' });
    this.configureRoute(AiTask.BALANCED, preferred, { openai: 'gpt-4o-mini', ollama: 'qwen2.5:14b' });
    this.configureRoute(AiTask.REASONING, preferred, { openai: 'gpt-4o', ollama: 'qwen2.5:32b' });

    const cloud = [...this.routes.values()].some((r) => r.provider !== 'ollama');
    if (cloud) {
      this.logger.warn(
        'AI is routed to a cloud provider — question text and the records the tools return leave the network.',
      );
    }

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

  /**
   * Resolves one tier: an explicit override wins, then the preferred provider,
   * then Ollama — which is always registered and needs no key, so there is
   * always somewhere to land.
   *
   * Every step checks the provider is actually registered. Falling through to
   * a preference whose key is missing used to produce a route that looked
   * configured and threw on the first question instead of at boot.
   */
  private configureRoute(
    task: AiTask,
    preferredProvider: string,
    modelsByProvider: Record<string, string>,
  ) {
    const tier = task.toUpperCase();
    const [overrideProvider, ...overrideModelParts] =
      this.config.get<string>(`AI_ROUTE_${tier}`)?.split(':') ?? [];
    // Ollama model names carry a colon (`qwen2.5:14b`), so the split is
    // rejoined rather than taking only the second field.
    const overrideModel = overrideModelParts.join(':');

    if (overrideProvider && !this.providers.has(overrideProvider)) {
      this.logger.warn(
        `AI_ROUTE_${tier} names "${overrideProvider}", which has no API key configured — ignoring it.`,
      );
    }
    if (
      !overrideProvider &&
      preferredProvider !== 'ollama' &&
      !this.providers.has(preferredProvider)
    ) {
      this.logger.warn(
        `Preferred provider "${preferredProvider}" has no API key — ${tier} falls back to the on-prem model.`,
      );
    }

    const overrideAccepted = Boolean(overrideProvider && this.providers.has(overrideProvider));

    const provider =
      (overrideAccepted && overrideProvider) ||
      (this.providers.has(preferredProvider) && preferredProvider) ||
      'ollama';

    this.routes.set(task, {
      provider,
      model:
        // The model comes with the override or not at all: keeping "grok-4"
        // after falling back off xAI produced a route reading
        // "openai:grok-4", which looked configured and 404'd on every call.
        (overrideAccepted && overrideModel) ||
        this.config.get<string>(`AI_MODEL_${tier}`) ||
        modelsByProvider[provider] ||
        modelsByProvider.ollama,
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
