/**
 * Release 3 — Bids, Tenders and the Bid/No-Bid decision.
 *
 * The spec's own framing matters here: "قرار No Bid ليس فشلًا" — declining a bid
 * is a legitimate commercial outcome, not a lost opportunity. The score exists
 * to make that decision defensible, not to automate it.
 */

/** An opportunity can carry several of these — a tender, then a change request. */
export const BID_TYPES = [
  'PUBLIC_TENDER',
  'PRIVATE_TENDER',
  'RFQ',
  'RFP',
  'DIRECT_NEGOTIATION',
  'FRAMEWORK_CALL_OFF',
  'RENEWAL',
  'CHANGE_REQUEST',
] as const;
export type BidType = (typeof BID_TYPES)[number];

export const BID_STATUSES = [
  'IDENTIFIED',
  'PREPARING',
  'SUBMITTED',
  'CLARIFICATION',
  'AWARDED',
  'LOST',
  'WITHDRAWN',
  'CANCELLED',
] as const;
export type BidStatus = (typeof BID_STATUSES)[number];

export const SUBMISSION_METHODS = [
  'PORTAL',
  'EMAIL',
  'HAND_DELIVERY',
  'COURIER',
] as const;
export type SubmissionMethod = (typeof SUBMISSION_METHODS)[number];

/** Bid Checklist rows: what the tender obliges us to produce. */
export const REQUIREMENT_TYPES = [
  'TECHNICAL',
  'COMMERCIAL',
  'LEGAL',
  'FINANCIAL',
  'HSE',
  'ADMINISTRATIVE',
] as const;
export type RequirementType = (typeof REQUIREMENT_TYPES)[number];

export const COMPLETION_STATUSES = [
  'NOT_STARTED',
  'IN_PROGRESS',
  'READY',
  'SUBMITTED',
  'WAIVED',
] as const;
export type CompletionStatus = (typeof COMPLETION_STATUSES)[number];

// ---------------------------------------------------------------------------
// Bid / No-Bid scoring
// ---------------------------------------------------------------------------

export const BID_DECISIONS = ['BID', 'NO_BID', 'BID_WITH_CONDITIONS', 'HOLD'] as const;
export type BidDecision = (typeof BID_DECISIONS)[number];

export const BID_SCORE_FACTORS = [
  'RELATIONSHIP_STRENGTH',
  'TECHNICAL_FIT',
  'DELIVERY_CAPACITY',
  'EXPECTED_PROFITABILITY',
  'PAYMENT_TERMS',
  'COMPETITION',
  'SCOPE_CLARITY',
  'STRATEGIC_VALUE',
] as const;
export type BidScoreFactor = (typeof BID_SCORE_FACTORS)[number];

export interface BidScoreFactorDefinition {
  code: BidScoreFactor;
  titleAr: string;
  titleEn: string;
  /** The spec calls these "وزن استرشادي" — indicative. They are configurable. */
  defaultWeight: number;
}

export const BID_SCORE_FACTOR_DEFINITIONS: readonly BidScoreFactorDefinition[] = [
  { code: 'RELATIONSHIP_STRENGTH', titleAr: 'قوة العلاقة', titleEn: 'Relationship strength', defaultWeight: 15 },
  { code: 'TECHNICAL_FIT', titleAr: 'الملاءمة الفنية', titleEn: 'Technical fit', defaultWeight: 15 },
  { code: 'DELIVERY_CAPACITY', titleAr: 'القدرة التنفيذية', titleEn: 'Delivery capacity', defaultWeight: 15 },
  { code: 'EXPECTED_PROFITABILITY', titleAr: 'الربحية المتوقعة', titleEn: 'Expected profitability', defaultWeight: 15 },
  { code: 'PAYMENT_TERMS', titleAr: 'شروط الدفع', titleEn: 'Payment terms', defaultWeight: 10 },
  { code: 'COMPETITION', titleAr: 'المنافسة', titleEn: 'Competition', defaultWeight: 10 },
  { code: 'SCOPE_CLARITY', titleAr: 'وضوح النطاق', titleEn: 'Scope clarity', defaultWeight: 10 },
  { code: 'STRATEGIC_VALUE', titleAr: 'القيمة الاستراتيجية', titleEn: 'Strategic value', defaultWeight: 10 },
];

/** Weights are a percentage split of a 100-point score, so they must total 100. */
export const TOTAL_BID_SCORE = 100;

/**
 * Each factor is rated on this scale. The spec fixes the weights but not the
 * rating scale; five steps keep an assessor's judgement honest (there is a
 * middle, and only two grades either side of it) and divide 100 exactly.
 */
export const BID_RATING_MIN = 0;
export const BID_RATING_MAX = 5;

export interface WeightIssue {
  code: 'MISSING_FACTOR' | 'UNKNOWN_FACTOR' | 'NEGATIVE_WEIGHT' | 'WRONG_TOTAL';
  detail: string;
}

/**
 * Weights are administrable, so they are also a way to quietly rig a decision.
 * Validation is strict for that reason: every factor present, none unknown, no
 * negatives, and a total of exactly 100.
 */
export function validateWeights(weights: Record<string, number>): WeightIssue[] {
  const issues: WeightIssue[] = [];
  const known = new Set<string>(BID_SCORE_FACTORS);

  for (const factor of BID_SCORE_FACTORS) {
    if (!(factor in weights)) {
      issues.push({ code: 'MISSING_FACTOR', detail: factor });
    }
  }
  for (const [key, value] of Object.entries(weights)) {
    if (!known.has(key)) issues.push({ code: 'UNKNOWN_FACTOR', detail: key });
    if (value < 0) issues.push({ code: 'NEGATIVE_WEIGHT', detail: key });
  }

  const total = Object.entries(weights)
    .filter(([key]) => known.has(key))
    .reduce((sum, [, value]) => sum + value, 0);
  if (Math.round(total * 100) / 100 !== TOTAL_BID_SCORE) {
    issues.push({ code: 'WRONG_TOTAL', detail: `weights total ${total}, expected ${TOTAL_BID_SCORE}` });
  }

  return issues;
}

export function defaultWeights(): Record<BidScoreFactor, number> {
  return Object.fromEntries(
    BID_SCORE_FACTOR_DEFINITIONS.map((f) => [f.code, f.defaultWeight]),
  ) as Record<BidScoreFactor, number>;
}

/**
 * Weighted total out of 100. A factor rated 5 earns its full weight, 0 earns
 * nothing, and an unrated factor scores nothing rather than being skipped —
 * an incomplete assessment must look incomplete, not flatteringly average.
 */
export function bidScore(
  ratings: Partial<Record<BidScoreFactor, number>>,
  weights: Record<string, number> = defaultWeights(),
): number {
  let total = 0;
  for (const factor of BID_SCORE_FACTORS) {
    const rating = ratings[factor] ?? 0;
    const clamped = Math.min(Math.max(rating, BID_RATING_MIN), BID_RATING_MAX);
    total += (weights[factor] ?? 0) * (clamped / BID_RATING_MAX);
  }
  return Math.round(total * 100) / 100;
}

/** Factors that were never rated — surfaced so a thin assessment is visible. */
export function unratedFactors(
  ratings: Partial<Record<BidScoreFactor, number>>,
): BidScoreFactor[] {
  return BID_SCORE_FACTORS.filter((f) => ratings[f] === undefined || ratings[f] === null);
}

/**
 * A SUGGESTION ONLY, and provisional.
 *
 * The spec gives the weights but never states the score at which Afro should
 * walk away, and it is explicit that thresholds elsewhere are illustrative
 * pending the client's real numbers. So this never sets the decision: the
 * decision is recorded by a person, and these bands exist to make an outlier
 * choice visible ("scored 31 and we bid anyway — why?"), not to make it.
 */
export const PROVISIONAL_DECISION_BANDS = { bid: 70, conditions: 55, hold: 40 } as const;

export interface DecisionBands {
  /** At or above this score the assessment suggests bidding. */
  bid: number;
  /** At or above this it suggests bidding with conditions. */
  conditions: number;
}

export interface DecisionSuggestion {
  decision: BidDecision | null;
  bands: DecisionBands | null;
  /** True when the bands came from Afro's settings rather than the fallback. */
  configured: boolean;
}

/**
 * Suggest a decision from the score, using the bands Afro configured.
 *
 * Release 6 made every other threshold a row a person edits, and these two
 * were the last constants pretending to be policy. They now come from
 * BID_GO_THRESHOLD and BID_CONDITIONAL_THRESHOLD.
 *
 * With no bands configured it returns null rather than falling back to 70/55.
 * The fallback is the whole problem: a number nobody at Afro chose, shown
 * beside a real score, reads exactly like a company decision. A missing
 * suggestion reads like what it is — nobody has said where the line is.
 */
export function suggestDecisionWithBands(
  score: number,
  bands: DecisionBands | null,
): DecisionSuggestion {
  if (!bands) return { decision: null, bands: null, configured: false };

  const decision: BidDecision =
    score >= bands.bid
      ? 'BID'
      : score >= bands.conditions
        ? 'BID_WITH_CONDITIONS'
        : 'NO_BID';

  return { decision, bands, configured: true };
}

/**
 * The original fixed-band form, kept for the tests that pin the provisional
 * numbers and for any caller that has no settings to read.
 *
 * @deprecated Prefer suggestDecisionWithBands with the configured bands.
 */
export function suggestDecision(score: number): BidDecision {
  if (score >= PROVISIONAL_DECISION_BANDS.bid) return 'BID';
  if (score >= PROVISIONAL_DECISION_BANDS.conditions) return 'BID_WITH_CONDITIONS';
  if (score >= PROVISIONAL_DECISION_BANDS.hold) return 'HOLD';
  return 'NO_BID';
}
