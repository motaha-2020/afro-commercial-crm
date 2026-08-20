import { AiProviderError, classifyProviderFailure } from './provider-error';

const failure = (raw: unknown, status = 429) =>
  classifyProviderFailure(new AiProviderError('groq', status, raw));

describe('classifyProviderFailure', () => {
  // One 429 hides three problems whose advice is the opposite of each other.
  it('tells the user that waiting will not help on a spend limit', () => {
    const result = failure({ error: { code: 'insufficient_quota', message: 'spend limit reached' } });

    expect(result.kind).toBe('spend_limit');
    expect(result.advice).toContain('الانتظار لا يفيد');
  });

  it('tells the user a daily quota does not renew before tomorrow', () => {
    const result = failure({
      error: { message: 'Rate limit reached for model: 14400 requests per day (RPD)' },
    });

    expect(result.kind).toBe('daily_quota');
    expect(result.advice).toContain('الغد');
  });

  it('quotes the provider’s own wait time on a per-minute limit', () => {
    const result = failure({
      error: { message: 'Limit 6000 tokens per minute (TPM). Please try again in 8.5s' },
    });

    expect(result.kind).toBe('rate_limit');
    expect(result.retryAfterSeconds).toBe(9);
    expect(result.advice).toContain('9 ثانية');
  });

  it('falls back to momentary pressure for a bare wrapper 429', () => {
    // The wrapper's own phrasing, carrying not one word from the provider.
    const result = failure('The service is receiving too many requests from you');

    expect(result.kind).toBe('rate_limit');
    expect(result.retryAfterSeconds).toBeUndefined();
  });

  it('finds the cause nested anywhere, not in two fields by name', () => {
    const result = failure({ outer: { inner: { detail: 'tokens per day exceeded' } } });
    expect(result.kind).toBe('daily_quota');
  });

  // The three strings below are verbatim from these providers on 19 Aug 2026.
  it('names a rejected OpenAI key as a credentials problem, not a budget one', () => {
    const result = classifyProviderFailure(
      new AiProviderError('openai', 401, {
        error: { message: 'Incorrect API key provided: sk-proj****. You can find your API key at https://platform.openai.com/account/api-keys.', code: 'invalid_api_key' },
      }),
    );

    expect(result.kind).toBe('bad_credentials');
    expect(result.advice).toContain('ملف البيئة');
  });

  it('names a rejected Gemini key as a credentials problem despite its 400', () => {
    const result = classifyProviderFailure(
      new AiProviderError('gemini', 400, [
        { error: { code: 400, message: 'Please pass a valid API key', status: 'INVALID_ARGUMENT' } },
      ]),
    );

    expect(result.kind).toBe('bad_credentials');
  });

  it('reads an unfunded-team 403 as no credit, not as unknown', () => {
    const result = classifyProviderFailure(
      new AiProviderError('xai', 403, {
        code: 'permission-denied',
        error: 'Your newly created team does not have any credits or licenses yet.',
      }),
    );

    expect(result.kind).toBe('spend_limit');
    expect(result.advice).toContain('الانتظار لا يفيد');
  });

  // Verbatim from Gemini's free tier on 20 Aug 2026. The sentence opens with
  // language that reads terminal and closes with a wait that works.
  it('trusts a stated retry time over the word "quota"', () => {
    const result = classifyProviderFailure(
      new AiProviderError('gemini', 429, [
        {
          error: {
            code: 429,
            message:
              'You exceeded your current quota, please check your plan and billing details. ' +
              'Quota exceeded for metric: generate_content_free_tier_requests, limit: 5. ' +
              'Please retry in 48.159903437s.',
            status: 'RESOURCE_EXHAUSTED',
          },
        },
      ]),
    );

    expect(result.kind).toBe('rate_limit');
    expect(result.retryAfterSeconds).toBe(49);
    expect(result.advice).not.toContain('الانتظار لا يفيد');
  });

  it('still calls it a spend limit when no wait is offered', () => {
    const result = classifyProviderFailure(
      new AiProviderError('openai', 429, { error: { code: 'insufficient_quota' } }),
    );

    expect(result.kind).toBe('spend_limit');
  });

  it('recognises an unreachable local model', () => {
    const cause = Object.assign(new Error('fetch failed'), { code: 'ECONNREFUSED' });
    const result = classifyProviderFailure(new AiProviderError('ollama', undefined, cause));

    expect(result.kind).toBe('unreachable');
    expect(result.advice).toContain('تعذّر الوصول');
  });
});
