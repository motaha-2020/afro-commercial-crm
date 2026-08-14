/**
 * Release 3 — Scope and Solution.
 *
 * The spec is emphatic that scope must be structured data, not prose: "النطاق
 * يجب ألا يكون نصًا طويلًا فقط", and assumptions in particular "يجب أن تكون
 * بيانات مستقلة وليست فقرة داخل ملف". Everything here exists so a disputed
 * scope can be answered with a row and a date rather than a paragraph in a PDF.
 */

export const SCOPE_CATEGORIES = [
  'SUPPLY',
  'DESIGN',
  'CIVIL_WORKS',
  'INSTALLATION',
  'TESTING',
  'ACCEPTANCE',
  'MAINTENANCE',
  'PROJECT_MANAGEMENT',
  'LOGISTICS',
  'OTHER',
] as const;
export type ScopeCategory = (typeof SCOPE_CATEGORIES)[number];

/**
 * A package is either in the deal or explicitly outside it. EXCLUDED is not a
 * deletion: an exclusion the customer agreed to is worth more at claim time
 * than a package that was quietly never mentioned.
 */
export const SCOPE_INCLUSIONS = ['INCLUDED', 'EXCLUDED', 'OPTIONAL'] as const;
export type ScopeInclusion = (typeof SCOPE_INCLUSIONS)[number];

export const SCOPE_PACKAGE_STATUSES = ['DRAFT', 'IN_REVIEW', 'CONFIRMED', 'SUPERSEDED'] as const;
export type ScopePackageStatus = (typeof SCOPE_PACKAGE_STATUSES)[number];

/** Who carries the obligation. The spec keeps both sides on every scope item. */
export const RESPONSIBILITIES = ['AFRO', 'CUSTOMER', 'SHARED', 'THIRD_PARTY'] as const;
export type Responsibility = (typeof RESPONSIBILITIES)[number];

export const ASSUMPTION_CATEGORIES = [
  'TECHNICAL',
  'COMMERCIAL',
  'SITE_ACCESS',
  'PERMITS',
  'CUSTOMER_INPUT',
  'SCHEDULE',
  'SUPPLY_CHAIN',
  'OTHER',
] as const;
export type AssumptionCategory = (typeof ASSUMPTION_CATEGORIES)[number];

/**
 * An assumption nobody confirmed is a risk carried silently — the confirmation
 * state is tracked so it can be counted, not just written down.
 */
export const CONFIRMATION_STATUSES = [
  'UNCONFIRMED',
  'SENT_TO_CUSTOMER',
  'CONFIRMED',
  'REJECTED',
] as const;
export type ConfirmationStatus = (typeof CONFIRMATION_STATUSES)[number];

export const CLARIFICATION_STATUSES = [
  'OPEN',
  'SENT',
  'ANSWERED',
  'CLOSED',
  'UNANSWERED_AT_SUBMISSION',
] as const;
export type ClarificationStatus = (typeof CLARIFICATION_STATUSES)[number];

/** How much an answer (or the absence of one) moves the bid. */
export const CLARIFICATION_IMPACTS = ['NONE', 'LOW', 'MEDIUM', 'HIGH', 'BLOCKING'] as const;
export type ClarificationImpact = (typeof CLARIFICATION_IMPACTS)[number];

export interface ScopeReadiness {
  packages: number;
  items: number;
  /** Assumptions still carrying no customer confirmation. */
  unconfirmedAssumptions: number;
  /** Clarifications with no answer yet. */
  openClarifications: number;
  /** Open clarifications that would change the price or the plan. */
  blockingClarifications: number;
  ready: boolean;
}

/**
 * Whether the scope is solid enough to price against.
 *
 * Deliberately not a percentage: a 90%-complete scope with one blocking
 * clarification is not 90% safe to bid, it is unsafe. Any blocking
 * clarification, or an empty scope, makes it not ready — and the caller sees
 * the counts, so the reason is never hidden behind a number.
 */
export function scopeReadiness(input: {
  packages: number;
  items: number;
  unconfirmedAssumptions: number;
  openClarifications: number;
  blockingClarifications: number;
}): ScopeReadiness {
  return {
    ...input,
    ready:
      input.packages > 0 && input.items > 0 && input.blockingClarifications === 0,
  };
}
