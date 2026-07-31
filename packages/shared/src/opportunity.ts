/**
 * Opportunity vocabulary.
 *
 * The spec mandates four INDEPENDENT readings of an opportunity. Collapsing any
 * two of them into one field is the single most common CRM modelling mistake and
 * is explicitly forbidden:
 *   stage            — where it sits in the sales lifecycle
 *   status           — whether it is live at all
 *   forecastCategory — how much the business is willing to bank on it
 *   health           — whether it is in trouble
 * A stage does not imply a status, and neither implies a forecast category.
 *
 * Every value is a CODE. Codes are stored and compared; translation happens only
 * at the presentation layer.
 */

export const OPPORTUNITY_STAGES = [
  'LEAD_INTAKE',
  'LEAD_QUALIFICATION',
  'OPPORTUNITY_QUALIFICATION',
  'SCOPE_DISCOVERY',
  'BID_STRATEGY_SOLUTION',
  'COSTING_SOURCING',
  'OPERATIONAL_FINANCIAL_REVIEW',
  'MANAGEMENT_APPROVAL',
  'PROPOSAL_SUBMISSION',
  'CLARIFICATIONS_NEGOTIATION',
  'AWARD_CONTRACTING',
  'PROJECT_HANDOVER',
  'ACTUAL_PERFORMANCE_FEEDBACK',
] as const;

export type OpportunityStage = (typeof OPPORTUNITY_STAGES)[number];

/** Sequence number per the spec's stage table (Lead Intake is stage 0). */
export const STAGE_ORDER: Record<OpportunityStage, number> = {
  LEAD_INTAKE: 0,
  LEAD_QUALIFICATION: 1,
  OPPORTUNITY_QUALIFICATION: 2,
  SCOPE_DISCOVERY: 3,
  BID_STRATEGY_SOLUTION: 4,
  COSTING_SOURCING: 5,
  OPERATIONAL_FINANCIAL_REVIEW: 6,
  MANAGEMENT_APPROVAL: 7,
  PROPOSAL_SUBMISSION: 8,
  CLARIFICATIONS_NEGOTIATION: 9,
  AWARD_CONTRACTING: 10,
  PROJECT_HANDOVER: 11,
  ACTUAL_PERFORMANCE_FEEDBACK: 12,
};

/** Primary owner role per stage, per the spec's stage table. */
export const STAGE_PRIMARY_OWNER: Record<OpportunityStage, string> = {
  LEAD_INTAKE: 'ACCOUNT_MANAGER',
  LEAD_QUALIFICATION: 'ACCOUNT_MANAGER',
  OPPORTUNITY_QUALIFICATION: 'SALES_DIRECTOR',
  SCOPE_DISCOVERY: 'PRESALES',
  BID_STRATEGY_SOLUTION: 'PRESALES',
  COSTING_SOURCING: 'ESTIMATION',
  OPERATIONAL_FINANCIAL_REVIEW: 'FINANCE',
  MANAGEMENT_APPROVAL: 'CEO',
  PROPOSAL_SUBMISSION: 'ESTIMATION',
  CLARIFICATIONS_NEGOTIATION: 'SALES_DIRECTOR',
  AWARD_CONTRACTING: 'LEGAL',
  PROJECT_HANDOVER: 'PROJECT_MANAGER',
  ACTUAL_PERFORMANCE_FEEDBACK: 'PROJECT_MANAGER',
};

export const OPPORTUNITY_STATUSES = [
  'ACTIVE',
  'ON_HOLD',
  'CANCELLED',
  'LOST',
  'CLOSED',
] as const;

export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number];

export const FORECAST_CATEGORIES = [
  'PIPELINE',
  'UPSIDE',
  'BEST_CASE',
  'COMMIT',
  'CLOSED_WON',
] as const;

export type ForecastCategory = (typeof FORECAST_CATEGORIES)[number];

export const HEALTH_STATES = ['GREEN', 'AMBER', 'RED'] as const;

export type HealthState = (typeof HEALTH_STATES)[number];

/**
 * Exit reasons. These are recorded alongside a terminal status rather than being
 * stages — an opportunity lost at Costing did not "reach" a Lost stage, it left
 * the lifecycle from wherever it stood.
 */
export const EXIT_REASONS = [
  'NO_BID',
  'LOST',
  'CANCELLED',
  'ON_HOLD',
  'DISQUALIFIED',
] as const;

export type ExitReason = (typeof EXIT_REASONS)[number];

/**
 * Progressive Data Capture: the minimum fields required to LEAVE a stage.
 *
 * The spec is explicit that a Lead must not demand dozens of fields up front —
 * obligations accumulate as the opportunity matures. Each entry lists the fields
 * that must be populated before advancing past that stage.
 */
export const STAGE_EXIT_REQUIREMENTS: Record<OpportunityStage, readonly string[]> = {
  LEAD_INTAKE: [
    'accountId',
    'name',
    'source',
    'country',
    'industry',
    'estimatedValue',
    'ownerId',
    'nextStep',
  ],
  LEAD_QUALIFICATION: ['primaryContactId', 'expectedCloseDate'],
  OPPORTUNITY_QUALIFICATION: ['bidNoBidScore', 'currency'],
  SCOPE_DISCOVERY: ['scopeSummary'],
  BID_STRATEGY_SOLUTION: ['solutionStrategy'],
  COSTING_SOURCING: ['estimatedCost'],
  OPERATIONAL_FINANCIAL_REVIEW: ['proposedPrice', 'marginPercent'],
  MANAGEMENT_APPROVAL: [],
  PROPOSAL_SUBMISSION: ['submissionDate'],
  CLARIFICATIONS_NEGOTIATION: [],
  AWARD_CONTRACTING: ['awardedValue'],
  PROJECT_HANDOVER: [],
  ACTUAL_PERFORMANCE_FEEDBACK: [],
};

/**
 * Margin is profit over SELLING PRICE. Markup is profit over COST.
 * The spec calls this out specifically because conflating them silently
 * misprices bids: cost 100 / price 125 is 25% markup but only 20% margin.
 */
export function marginPercent(cost: number, price: number): number {
  if (price === 0) return 0;
  return ((price - cost) / price) * 100;
}

export function markupPercent(cost: number, price: number): number {
  if (cost === 0) return 0;
  return ((price - cost) / cost) * 100;
}
