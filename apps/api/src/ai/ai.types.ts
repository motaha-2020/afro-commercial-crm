/**
 * Task tiers other modules pick from — the router resolves each tier to a
 * concrete provider + model. Callers never hardcode a provider or model name.
 */
export enum AiTask {
  /** Cheap/quick: classification, tagging, short extraction. */
  FAST = 'fast',
  /** Everyday default: summaries, drafting, general Q&A. */
  BALANCED = 'balanced',
  /** Complex multi-step analysis where quality matters more than cost. */
  REASONING = 'reasoning',
}
