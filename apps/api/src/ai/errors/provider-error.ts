export type ProviderFailureKind =
  | 'bad_credentials'
  | 'spend_limit'
  | 'daily_quota'
  | 'rate_limit'
  | 'unreachable'
  | 'unknown';

export interface ProviderFailure {
  kind: ProviderFailureKind;
  /** Arabic sentence shown to the user. Each kind's advice contradicts the others. */
  advice: string;
  /** Seconds the provider itself asked us to wait, when it said so. */
  retryAfterSeconds?: number;
}

/**
 * Carries the provider's own words, not just a status code. The wrapper's
 * phrasing ("too many requests") shares a status with three different causes
 * whose advice is opposite, so the whole error object travels with the throw
 * and is classified by scanning it — never by reading two named fields.
 */
export class AiProviderError extends Error {
  constructor(
    readonly provider: string,
    readonly status: number | undefined,
    /** Everything the provider returned, kept whole for classification. */
    readonly raw: unknown,
  ) {
    super(`AI provider "${provider}" request failed${status ? ` with status ${status}` : ''}`);
    this.name = 'AiProviderError';
  }
}

/** Serialise the entire object — including non-enumerable Error fields — then scan. */
function flatten(raw: unknown): string {
  if (raw instanceof Error) {
    return `${raw.name} ${raw.message} ${flatten({ ...raw })}`;
  }
  if (typeof raw === 'string') return raw;
  try {
    return JSON.stringify(raw) ?? String(raw);
  } catch {
    return String(raw);
  }
}

function findRetrySeconds(text: string): number | undefined {
  // Quote the number the provider states rather than inventing a backoff.
  const match =
    /(?:try again|retry) in ([\d.]+)\s*(ms|s|seconds?)/i.exec(text) ??
    /retry[- ]after["':\s]+([\d.]+)/i.exec(text);
  if (!match) return undefined;

  const value = Number(match[1]);
  if (!Number.isFinite(value)) return undefined;
  return match[2]?.toLowerCase() === 'ms' ? Math.ceil(value / 1000) : Math.ceil(value);
}

export function classifyProviderFailure(error: unknown): ProviderFailure {
  const status = error instanceof AiProviderError ? error.status : undefined;
  const haystack = flatten(
    error instanceof AiProviderError ? { status, raw: error.raw, message: error.message } : error,
  ).toLowerCase();

  // Checked before the quota branches: a rejected key and an exhausted budget
  // both surface as "you cannot call this", and telling someone to raise a
  // spending limit when the key itself is wrong sends them to the wrong page.
  if (
    status === 401 ||
    /incorrect api key|invalid api key|invalid_api_key|pass a valid api key|unauthorized|authentication/.test(
      haystack,
    )
  ) {
    return {
      kind: 'bad_credentials',
      advice: 'مفتاح المزوّد مرفوض — راجع المفتاح في ملف البيئة، فلا شيء سيعمل قبل تصحيحه.',
    };
  }

  // A provider that names a wait is telling us waiting works, whatever else
  // the sentence says. Gemini's free-tier 429 reads "You exceeded your current
  // quota" -- which sounds terminal -- and then asks for a retry in 48s; on the
  // word "quota" alone we told the user that waiting would not help, and it
  // was the only thing that would.
  const statedWait = findRetrySeconds(haystack);
  if (statedWait !== undefined) {
    return {
      kind: 'rate_limit',
      retryAfterSeconds: statedWait,
      advice: `ضغط لحظي على المزوّد — أعد المحاولة بعد ${statedWait} ثانية.`,
    };
  }

  if (
    /spend limit|insufficient_quota|billing|credit balance|any credits|no credits|quota exceeded/.test(
      haystack,
    )
  ) {
    return {
      kind: 'spend_limit',
      advice: 'لا رصيد لدى المزوّد — الانتظار لا يفيد، يلزم شحن الحساب أو تبديل المزوّد.',
    };
  }

  if (/per day|per-day|\btpd\b|\brpd\b|daily limit/.test(haystack)) {
    return {
      kind: 'daily_quota',
      advice: 'بلغت الحصة اليومية للمزوّد — لا تتجدد قبل الغد.',
    };
  }

  if (/per minute|per-minute|\btpm\b|\brpm\b/.test(haystack)) {
    const retryAfterSeconds = findRetrySeconds(haystack);
    return {
      kind: 'rate_limit',
      retryAfterSeconds,
      advice: retryAfterSeconds
        ? `ضغط لحظي على المزوّد — أعد المحاولة بعد ${retryAfterSeconds} ثانية.`
        : 'ضغط لحظي على المزوّد — أعد المحاولة بعد قليل.',
    };
  }

  if (status === 429 || /too many requests|rate.?limit/.test(haystack)) {
    return {
      kind: 'rate_limit',
      retryAfterSeconds: findRetrySeconds(haystack),
      advice: 'ضغط لحظي على المزوّد — أعد المحاولة بعد قليل.',
    };
  }

  if (/econnrefused|enotfound|etimedout|fetch failed|socket hang up/.test(haystack)) {
    return {
      kind: 'unreachable',
      advice: 'تعذّر الوصول إلى خدمة النموذج — تأكد أنها تعمل على نفس الخادم.',
    };
  }

  return {
    kind: 'unknown',
    advice: 'فشل نداء النموذج لسبب غير مصنَّف — راجع سجل الخادم.',
  };
}
