import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiTask } from './ai.types';
import { AiProvider, AiCompletionResult, AiMessage } from './providers/ai-provider.interface';
import { OpenAiCompatibleProvider } from './providers/openai-compatible.provider';

interface Route {
  provider: string;
  model: string;
}

/**
 * Routes each AiTask tier to a provider + model, keyed off whichever API
 * keys are actually configured. Only XAI_API_KEY is set today; OPENAI_API_KEY
 * and GEMINI_API_KEY slot in later without callers changing anything.
 */
@Injectable()
export class AiRouterService implements OnModuleInit {
  private readonly logger = new Logger(AiRouterService.name);
  private readonly providers = new Map<string, AiProvider>();
  private readonly routes = new Map<AiTask, Route>();

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    this.registerProvider(
      'xai',
      this.config.get<string>('XAI_BASE_URL', 'https://api.x.ai/v1'),
      this.config.get<string>('XAI_API_KEY'),
    );
    this.registerProvider(
      'openai',
      this.config.get<string>('OPENAI_BASE_URL', 'https://api.openai.com/v1'),
      this.config.get<string>('OPENAI_API_KEY'),
    );
    this.registerProvider(
      'gemini',
      this.config.get<string>(
        'GEMINI_BASE_URL',
        'https://generativelanguage.googleapis.com/v1beta/openai',
      ),
      this.config.get<string>('GEMINI_API_KEY'),
    );

    // Cheapest model that's fit for each tier, picked from whichever
    // providers are actually funded. xAI has no credits yet (see AI_ROUTE_*
    // overrides in .env.example) so it isn't a default until that's fixed.
    this.configureRoute(AiTask.FAST, 'gemini', 'gemini-flash-latest');
    this.configureRoute(AiTask.BALANCED, 'openai', 'gpt-4o-mini');
    this.configureRoute(AiTask.REASONING, 'openai', 'gpt-4o');

    if (this.providers.size === 0) {
      this.logger.warn('No AI provider API keys configured — AI features are disabled.');
    }
  }

  private registerProvider(name: string, baseUrl: string, apiKey: string | undefined) {
    if (!apiKey) return;
    this.providers.set(name, new OpenAiCompatibleProvider(name, baseUrl, apiKey));
  }

  /**
   * A route falls back to whatever provider is actually configured, so tasks
   * keep working with only XAI_API_KEY set even though the "ideal" provider
   * for that tier (e.g. OpenAI for FAST) isn't wired up yet.
   */
  private configureRoute(task: AiTask, preferredProvider: string, defaultModel: string) {
    const providerOverride = this.config.get<string>(`AI_ROUTE_${task.toUpperCase()}`);
    const [overrideProvider, overrideModel] = providerOverride?.split(':') ?? [];

    const provider =
      (overrideProvider && this.providers.has(overrideProvider) && overrideProvider) ||
      (this.providers.has(preferredProvider) && preferredProvider) ||
      [...this.providers.keys()][0];

    if (!provider) return;

    this.routes.set(task, {
      provider,
      model: overrideModel || this.config.get<string>(`AI_MODEL_${task.toUpperCase()}`, defaultModel),
    });
  }

  async complete(
    task: AiTask,
    messages: AiMessage[],
    options?: { temperature?: number; maxTokens?: number; jsonMode?: boolean },
  ): Promise<AiCompletionResult> {
    const route = this.routes.get(task);
    if (!route) {
      throw new Error(
        `No AI provider available for task "${task}" — configure XAI_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY.`,
      );
    }

    const provider = this.providers.get(route.provider);
    if (!provider) {
      throw new Error(`AI provider "${route.provider}" is not registered.`);
    }

    return provider.complete({
      model: route.model,
      messages,
      temperature: options?.temperature,
      maxTokens: options?.maxTokens,
      jsonMode: options?.jsonMode,
    });
  }
}
