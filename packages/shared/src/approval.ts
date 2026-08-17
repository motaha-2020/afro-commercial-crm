/**
 * Release 6 — the approval engine, as data rather than code.
 *
 * The spec refuses a hard-coded workflow outright (section 28): "لا أنصح بوضع
 * Workflow ثابت داخل الكود. نحتاج Workflow قابلًا للتهيئة". Afro Group gave the
 * same answer when asked for the real approval limits — there is no single set,
 * because they differ by project, by opportunity and by country, and the
 * responsible manager needs room to set them.
 *
 * So nothing here contains a threshold. This file knows how to *resolve* which
 * threshold applies and how to *evaluate* a rule against a deal; the numbers
 * themselves live in rows a person edits. That distinction is the whole design:
 * a number in this file would be a number nobody at Afro agreed to.
 *
 * The provisional Bid/No-Bid bands (70/55/40) that have been sitting in the
 * code since Release 3 marked "clearly temporary" become policy rows too, which
 * is why their keys appear below.
 */

// ---------------------------------------------------------------------------
// What can be configured
// ---------------------------------------------------------------------------

export const APPROVAL_POLICY_KEYS = [
  'MIN_GROSS_MARGIN_PERCENT',
  'MIN_SELLING_PRICE_MARGIN_PERCENT',
  'APPROVAL_VALUE_LIMIT',
  'MAX_PAYMENT_TERM_DAYS',
  'MAX_DISCOUNT_PERCENT',
  'BID_GO_THRESHOLD',
  'BID_CONDITIONAL_THRESHOLD',
] as const;
export type ApprovalPolicyKey = (typeof APPROVAL_POLICY_KEYS)[number];

export const APPROVAL_CONDITION_FIELDS = [
  'GROSS_MARGIN_PERCENT',
  'OPPORTUNITY_VALUE',
  'PAYMENT_TERM_DAYS',
  'DISCOUNT_PERCENT',
  'COUNTRY_IS_NEW',
  'SINGLE_SOURCE_SUPPLIER',
  'FOREIGN_CURRENCY',
  'SCOPE_NOT_READY',
] as const;
export type ApprovalConditionField = (typeof APPROVAL_CONDITION_FIELDS)[number];

export const APPROVAL_OPERATORS = [
  'LESS_THAN',
  'LESS_OR_EQUAL',
  'GREATER_THAN',
  'GREATER_OR_EQUAL',
  'EQUALS',
  'IS_TRUE',
] as const;
export type ApprovalOperator = (typeof APPROVAL_OPERATORS)[number];

export const APPROVAL_DECISIONS = [
  'APPROVE',
  'REJECT',
  'RETURN_FOR_REVISION',
  'APPROVE_WITH_CONDITIONS',
] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

/** The decisions the spec lists for an approver, and what each does to a request. */
export const DECISION_OUTCOME: Record<ApprovalDecision, string> = {
  APPROVE: 'APPROVED',
  REJECT: 'REJECTED',
  RETURN_FOR_REVISION: 'RETURNED_FOR_REVISION',
  APPROVE_WITH_CONDITIONS: 'APPROVED_WITH_CONDITIONS',
};

/**
 * A decision that closes the request for good. "Return for revision" does not:
 * the deal comes back, which is the entire point of having it as a separate
 * verb rather than a rejection with a polite comment.
 */
export function isTerminalDecision(decision: ApprovalDecision): boolean {
  return decision !== 'RETURN_FOR_REVISION';
}

/** Conditions that read a yes/no fact rather than compare a number. */
export const BOOLEAN_CONDITION_FIELDS: readonly ApprovalConditionField[] = [
  'COUNTRY_IS_NEW',
  'SINGLE_SOURCE_SUPPLIER',
  'FOREIGN_CURRENCY',
  'SCOPE_NOT_READY',
] as const;

export function isBooleanCondition(field: ApprovalConditionField): boolean {
  return BOOLEAN_CONDITION_FIELDS.includes(field);
}

// ---------------------------------------------------------------------------
// Which policy row applies
// ---------------------------------------------------------------------------

export interface PolicyScope {
  country?: string | null;
  orgUnitId?: string | null;
  opportunityId?: string | null;
}

export interface PolicyRow extends PolicyScope {
  key: ApprovalPolicyKey;
  value: number;
  effectiveFrom: Date;
  effectiveTo?: Date | null;
}

/**
 * How specific a policy row is. The narrowest match wins, so a limit set on one
 * opportunity overrides the country's, which overrides the group default.
 *
 * Scored rather than sorted by a chain of ifs because the precedence has to be
 * stated once and be checkable — this is the rule a manager will lean on when
 * they set a special limit for a single hard deal, and it silently failing to
 * take effect is the kind of bug nobody notices until an approval that should
 * have been escalated was not.
 */
export function policySpecificity(row: PolicyScope): number {
  let score = 0;
  if (row.opportunityId) score += 4;
  if (row.orgUnitId) score += 2;
  if (row.country) score += 1;
  return score;
}

export interface ResolveContext extends PolicyScope {
  asOf?: Date;
}

/**
 * The single value in force for a key, given where the deal sits and when.
 *
 * Returns null rather than a default when nothing matches. That is deliberate:
 * a missing policy means Afro has not set that limit yet, and inventing one
 * here would put a number nobody agreed to in front of an approver. The caller
 * must say "not configured" out loud instead.
 */
export function resolvePolicy(
  rows: readonly PolicyRow[],
  key: ApprovalPolicyKey,
  ctx: ResolveContext = {},
): PolicyRow | null {
  const asOf = ctx.asOf ?? new Date();

  const applicable = rows.filter((row) => {
    if (row.key !== key) return false;
    if (row.effectiveFrom > asOf) return false;
    if (row.effectiveTo && row.effectiveTo <= asOf) return false;
    // A scoped row applies only to its own scope; an unset column means "any".
    if (row.country && row.country !== ctx.country) return false;
    if (row.orgUnitId && row.orgUnitId !== ctx.orgUnitId) return false;
    if (row.opportunityId && row.opportunityId !== ctx.opportunityId) return false;
    return true;
  });

  if (applicable.length === 0) return null;

  return applicable.reduce((best, row) => {
    const d = policySpecificity(row) - policySpecificity(best);
    if (d > 0) return row;
    if (d < 0) return best;
    // Same specificity: the more recently effective row is the current one.
    return row.effectiveFrom > best.effectiveFrom ? row : best;
  });
}

/** Every key's current value, for snapshotting onto an approval request. */
export function policySnapshot(
  rows: readonly PolicyRow[],
  ctx: ResolveContext = {},
): Partial<Record<ApprovalPolicyKey, number>> {
  const snap: Partial<Record<ApprovalPolicyKey, number>> = {};
  for (const key of APPROVAL_POLICY_KEYS) {
    const row = resolvePolicy(rows, key, ctx);
    if (row) snap[key] = row.value;
  }
  return snap;
}

// ---------------------------------------------------------------------------
// Evaluating a rule against a deal
// ---------------------------------------------------------------------------

/** The facts a rule can be written about. Undefined means "not known yet". */
export interface DealFacts {
  grossMarginPercent?: number;
  opportunityValue?: number;
  paymentTermDays?: number;
  discountPercent?: number;
  countryIsNew?: boolean;
  singleSourceSupplier?: boolean;
  foreignCurrency?: boolean;
  scopeNotReady?: boolean;
}

export interface RuleRow {
  id: string;
  conditionField: ApprovalConditionField;
  operator: ApprovalOperator;
  threshold?: number | null;
  thresholdPolicyKey?: ApprovalPolicyKey | null;
  requiredRole: string;
  priority?: number;
  isActive?: boolean;
  reason?: string | null;
}

const FACT_OF: Record<ApprovalConditionField, keyof DealFacts> = {
  GROSS_MARGIN_PERCENT: 'grossMarginPercent',
  OPPORTUNITY_VALUE: 'opportunityValue',
  PAYMENT_TERM_DAYS: 'paymentTermDays',
  DISCOUNT_PERCENT: 'discountPercent',
  COUNTRY_IS_NEW: 'countryIsNew',
  SINGLE_SOURCE_SUPPLIER: 'singleSourceSupplier',
  FOREIGN_CURRENCY: 'foreignCurrency',
  SCOPE_NOT_READY: 'scopeNotReady',
};

export function compare(left: number, operator: ApprovalOperator, right: number): boolean {
  switch (operator) {
    case 'LESS_THAN':
      return left < right;
    case 'LESS_OR_EQUAL':
      return left <= right;
    case 'GREATER_THAN':
      return left > right;
    case 'GREATER_OR_EQUAL':
      return left >= right;
    case 'EQUALS':
      return left === right;
    case 'IS_TRUE':
      return left !== 0;
  }
}

export interface FiredRule {
  ruleId: string;
  requiredRole: string;
  conditionField: ApprovalConditionField;
  operator: ApprovalOperator;
  /** The number actually compared against, after resolving any policy key. */
  threshold: number | null;
  actual: number | boolean;
  reason?: string | null;
}

export interface RuleEvaluation {
  fired: FiredRule[];
  /** Rules that could not be judged, and why. Never silently dropped. */
  undetermined: { ruleId: string; reason: 'NO_THRESHOLD_CONFIGURED' | 'FACT_UNKNOWN' }[];
}

/**
 * Which approvals a deal triggers.
 *
 * A rule that cannot be judged is reported as undetermined rather than treated
 * as not firing. The difference matters: "the margin is fine" and "nobody has
 * told us what margin is acceptable" look identical to an approver otherwise,
 * and only one of them means the deal is safe to wave through.
 */
export function evaluateRules(
  rules: readonly RuleRow[],
  facts: DealFacts,
  policies: readonly PolicyRow[] = [],
  ctx: ResolveContext = {},
): RuleEvaluation {
  const fired: FiredRule[] = [];
  const undetermined: RuleEvaluation['undetermined'] = [];

  for (const rule of rules) {
    if (rule.isActive === false) continue;

    const factKey = FACT_OF[rule.conditionField];
    const actual = facts[factKey];
    if (actual === undefined || actual === null) {
      undetermined.push({ ruleId: rule.id, reason: 'FACT_UNKNOWN' });
      continue;
    }

    if (isBooleanCondition(rule.conditionField)) {
      // A yes/no fact needs no threshold: the condition is the fact itself.
      if (actual === true) {
        fired.push({
          ruleId: rule.id,
          requiredRole: rule.requiredRole,
          conditionField: rule.conditionField,
          operator: rule.operator,
          threshold: null,
          actual: true,
          reason: rule.reason,
        });
      }
      continue;
    }

    let threshold: number | null | undefined = rule.threshold ?? null;
    if (rule.thresholdPolicyKey) {
      const row = resolvePolicy(policies, rule.thresholdPolicyKey, ctx);
      threshold = row ? row.value : null;
    }
    if (threshold === null || threshold === undefined) {
      undetermined.push({ ruleId: rule.id, reason: 'NO_THRESHOLD_CONFIGURED' });
      continue;
    }

    if (compare(Number(actual), rule.operator, threshold)) {
      fired.push({
        ruleId: rule.id,
        requiredRole: rule.requiredRole,
        conditionField: rule.conditionField,
        operator: rule.operator,
        threshold,
        actual: Number(actual),
        reason: rule.reason,
      });
    }
  }

  // Highest priority first so the approvals queue leads with the reason that
  // matters most, not whichever rule happened to be created first.
  fired.sort((a, b) => {
    const pa = rules.find((r) => r.id === a.ruleId)?.priority ?? 0;
    const pb = rules.find((r) => r.id === b.ruleId)?.priority ?? 0;
    return pb - pa;
  });

  return { fired, undetermined };
}

/** The distinct roles a deal must collect approval from. */
export function requiredApprovers(evaluation: RuleEvaluation): string[] {
  return [...new Set(evaluation.fired.map((f) => f.requiredRole))];
}

/**
 * Whether a deal may proceed without any approval at all. Undetermined rules
 * block it: an unanswered question is not a pass.
 */
export function needsApproval(evaluation: RuleEvaluation): boolean {
  return evaluation.fired.length > 0 || evaluation.undetermined.length > 0;
}

/**
 * The eight kinds of proposal a deal can put in front of a customer.
 */
export const PROPOSAL_TYPES = [
  'BUDGETARY',
  'INITIAL',
  'REVISED',
  'BAFO',
  'FINAL',
  'TECHNICAL',
  'COMMERCIAL',
  'COMBINED',
] as const;
export type ProposalType = (typeof PROPOSAL_TYPES)[number];

/**
 * Whether this kind of proposal quotes the customer a price, and therefore may
 * not exist without an approved costing behind it.
 *
 * The rule is the spec's, stated plainly in section 26: a commercial proposal
 * must reference an approved costing version, and no arbitrary price may be
 * typed in beside it. What lives here is only the question of which types the
 * rule applies to — and it lives here because the screen has to ask it before
 * the user submits. A screen that offered a price field the API would refuse
 * would be teaching people to ignore the form.
 *
 * TECHNICAL carries no number at all, so the rule would be meaningless on it.
 */
export function isCommercialProposal(type: string): boolean {
  return type !== 'TECHNICAL';
}

/** The statuses a proposal version moves through, in the order it moves. */
export const PROPOSAL_VERSION_STATUSES = [
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'SUBMITTED',
  'SUPERSEDED',
  'WITHDRAWN',
] as const;
export type ProposalVersionStatus = (typeof PROPOSAL_VERSION_STATUSES)[number];

/**
 * Whether this version can still be sent.
 *
 * A sent version is a fact about what the customer is holding, so it is never
 * re-sent or edited — it is superseded by a new one. Withdrawn and superseded
 * versions are history for the same reason.
 */
export function canSubmitProposalVersion(status: string): boolean {
  return status === 'DRAFT' || status === 'PENDING_APPROVAL' || status === 'APPROVED';
}
