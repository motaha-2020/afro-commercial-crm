import { AiRouterService } from './ai-router.service';
import { AiTask } from './ai.types';

/** Only the reads the router makes; anything unset behaves as absent. */
function router(env: Record<string, string | undefined>) {
  const service = new AiRouterService({
    get: (key: string, fallback?: string) => env[key] ?? fallback,
  } as never);
  service.onModuleInit();
  return service;
}

/** The chosen route, read back the way `complete` would resolve it. */
function routeOf(service: AiRouterService, task: AiTask) {
  return (service as unknown as { routes: Map<AiTask, { provider: string; model: string }> }).routes.get(
    task,
  );
}

describe('AiRouterService route resolution', () => {
  it('defaults every tier to OpenAI when its key is present', () => {
    const service = router({ OPENAI_API_KEY: 'sk-test' });

    expect(routeOf(service, AiTask.FAST)).toEqual({ provider: 'openai', model: 'gpt-4o-mini' });
    expect(routeOf(service, AiTask.BALANCED)).toEqual({ provider: 'openai', model: 'gpt-4o-mini' });
    expect(routeOf(service, AiTask.REASONING)).toEqual({ provider: 'openai', model: 'gpt-4o' });
  });

  it('falls back to the on-prem model when the default provider has no key', () => {
    // Not a route that throws on the first question: Ollama needs no key and
    // is always registered, so there is always somewhere to land.
    const service = router({});

    expect(routeOf(service, AiTask.BALANCED)).toEqual({
      provider: 'ollama',
      model: 'qwen2.5:14b',
    });
  });

  it('moves the whole stack on-prem with one variable', () => {
    const service = router({ OPENAI_API_KEY: 'sk-test', AI_DEFAULT_PROVIDER: 'ollama' });

    expect(routeOf(service, AiTask.FAST)?.provider).toBe('ollama');
    expect(routeOf(service, AiTask.BALANCED)?.provider).toBe('ollama');
    expect(routeOf(service, AiTask.REASONING)?.provider).toBe('ollama');
  });

  it('lets one tier be overridden without touching the others', () => {
    const service = router({
      OPENAI_API_KEY: 'sk-test',
      GEMINI_API_KEY: 'g-test',
      AI_ROUTE_FAST: 'gemini:gemini-flash-latest',
    });

    expect(routeOf(service, AiTask.FAST)).toEqual({
      provider: 'gemini',
      model: 'gemini-flash-latest',
    });
    expect(routeOf(service, AiTask.BALANCED)?.provider).toBe('openai');
  });

  it('keeps the colon inside an Ollama model name', () => {
    // Splitting on ":" and taking field two would route to "qwen2.5" and every
    // call would 404 on a model that does not exist.
    const service = router({ AI_ROUTE_BALANCED: 'ollama:qwen2.5:14b' });

    expect(routeOf(service, AiTask.BALANCED)).toEqual({
      provider: 'ollama',
      model: 'qwen2.5:14b',
    });
  });

  it('drops the model along with an override whose provider has no key', () => {
    const service = router({ OPENAI_API_KEY: 'sk-test', AI_ROUTE_BALANCED: 'xai:grok-4' });

    // Asserting the provider alone once hid this: the fallback took openai
    // but kept "grok-4", giving a route that read as configured and 404'd on
    // every call.
    expect(routeOf(service, AiTask.BALANCED)).toEqual({
      provider: 'openai',
      model: 'gpt-4o-mini',
    });
  });

  it('refuses to answer for a tier that has no route rather than guessing', async () => {
    const service = router({ OPENAI_API_KEY: 'sk-test' });
    (service as unknown as { routes: Map<AiTask, unknown> }).routes.delete(AiTask.FAST);

    await expect(service.complete(AiTask.FAST, [])).rejects.toThrow(/No AI route/);
  });
});
