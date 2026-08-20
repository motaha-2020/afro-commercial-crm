/**
 * G&A and overheads — the last gap in Release 4.
 *
 * It was deferred rather than guessed, and the spec says why in its first line
 * on the subject (section 18): "لا أنصح بوضع نسبة G&A واحدة على كل شيء" — do
 * not put one G&A percentage on everything. A single rate is the thing that
 * makes a bid in a cheap country subsidise one in an expensive country while
 * both look correctly priced.
 *
 * So overheads are rules: several methods, scoped by country and business
 * unit, dated, and — the part that is easy to drop — approved by Finance
 * before they touch a number. Section 19 states the principle for tax rules
 * and it governs here too: "النظام لا يقرر المعالجة المحاسبية وحده، بل يطبق
 * قواعد معتمدة من Finance."
 *
 * Two traps are handled explicitly, because both produce totals that look
 * plausible and are wrong:
 *
 *   Order dependence. If a percentage rule took "cost so far" as its base,
 *   then G&A 10% followed by overhead 5% would not equal overhead 5% followed
 *   by G&A 10%. Every percentage is computed on the SAME direct-cost base, so
 *   the total does not depend on the order rules happen to be listed in.
 *
 *   Self-feeding revenue. A rule expressed as a percentage of revenue cannot
 *   raise the cost, thereby raising the price, thereby raising itself. It is
 *   computed once against the selling price as it already stands, and never
 *   iterated.
 */

export const COST_RULE_CATEGORIES = [
  'G_AND_A',
  'OVERHEAD',
  'FINANCING',
  'RISK_PROVISION',
  'INSURANCE',
] as const;
export type CostRuleCategory = (typeof COST_RULE_CATEGORIES)[number];

export const COST_RULE_METHODS = [
  /** A share of the direct cost — the ordinary case. */
  'PERCENT_OF_DIRECT_COST',
  /** A share of the selling price. Computed once, never iterated. */
  'PERCENT_OF_REVENUE',
  /** A flat sum, regardless of size. */
  'FIXED_AMOUNT',
  /** A monthly rate multiplied by the project's duration. */
  'MONTHLY_RATE',
] as const;
export type CostRuleMethod = (typeof COST_RULE_METHODS)[number];

export const COST_RULE_APPROVAL_STATUSES = ['DRAFT', 'APPROVED', 'REJECTED'] as const;
export type CostRuleApprovalStatus = (typeof COST_RULE_APPROVAL_STATUSES)[number];

export interface CostRule {
  id: string;
  name: string;
  category: CostRuleCategory;
  method: CostRuleMethod;
  /** A percentage for the percent methods, an amount for the others. */
  value: number;
  country?: string | null;
  orgUnitId?: string | null;
  /** Narrowest scope of all: this one bid and no other. */
  opportunityId?: string | null;
  effectiveFrom: Date;
  effectiveTo?: Date | null;
  approvalStatus: CostRuleApprovalStatus;
}

export interface CostRuleContext {
  country?: string | null;
  orgUnitId?: string | null;
  opportunityId?: string | null;
  asOf?: Date;
}

export interface CostBase {
  /** Sum of the breakdown lines — never includes any rule's own output. */
  directCost: number;
  sellingPrice: number;
  /** Months, for MONTHLY_RATE. */
  durationMonths?: number | null;
}

export interface AppliedCostRule {
  ruleId: string;
  name: string;
  category: CostRuleCategory;
  method: CostRuleMethod;
  value: number;
  amount: number;
  /** What the amount was computed against, so a reader can check it. */
  basis: number;
}

export interface IndirectCostResult {
  applied: AppliedCostRule[];
  byCategory: Record<CostRuleCategory, number>;
  total: number;
  /**
   * Rules that matched but could not be computed, and why. Never silently
   * skipped: an overhead that quietly failed to apply is a bid that is cheaper
   * than the company can deliver for.
   */
  skipped: { ruleId: string; name: string; reason: 'NO_DURATION' | 'NO_SELLING_PRICE' }[];
}

/**
 * How specific a rule is; the narrowest wins within a category.
 *
 * The weights are powers of two so that a narrower dimension always outranks
 * every combination of wider ones: an opportunity rule beats a rule scoped to
 * both an org unit and a country, which is the whole point of writing one.
 */
export function ruleSpecificity(
  rule: Pick<CostRule, 'country' | 'orgUnitId' | 'opportunityId'>,
): number {
  return (rule.opportunityId ? 4 : 0) + (rule.orgUnitId ? 2 : 0) + (rule.country ? 1 : 0);
}

/**
 * The rules in force for a context.
 *
 * Approval is checked first and without exception. A draft rule is somebody's
 * proposal, and applying proposals to real bids is how a company discovers its
 * overhead policy after the fact.
 *
 * Within a category the narrowest scope wins: a rule set for Egypt replaces
 * the group default rather than stacking on top of it, and a rule written for
 * a single opportunity replaces both. Across categories they accumulate,
 * because G&A and financing are different costs, not two opinions about the
 * same one.
 */
export function applicableRules(
  rules: readonly CostRule[],
  ctx: CostRuleContext = {},
): CostRule[] {
  const asOf = ctx.asOf ?? new Date();

  const live = rules.filter((r) => {
    if (r.approvalStatus !== 'APPROVED') return false;
    if (r.effectiveFrom > asOf) return false;
    if (r.effectiveTo && r.effectiveTo <= asOf) return false;
    if (r.country && r.country !== ctx.country) return false;
    if (r.orgUnitId && r.orgUnitId !== ctx.orgUnitId) return false;
    // A rule written for one bid never leaks onto another, and never applies
    // at all when the caller is costing nothing in particular.
    if (r.opportunityId && r.opportunityId !== ctx.opportunityId) return false;
    return true;
  });

  const bestPerCategory = new Map<CostRuleCategory, CostRule>();
  for (const rule of live) {
    const current = bestPerCategory.get(rule.category);
    if (!current) {
      bestPerCategory.set(rule.category, rule);
      continue;
    }
    const d = ruleSpecificity(rule) - ruleSpecificity(current);
    if (d > 0 || (d === 0 && rule.effectiveFrom > current.effectiveFrom)) {
      bestPerCategory.set(rule.category, rule);
    }
  }

  return [...bestPerCategory.values()];
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * The indirect cost a costing carries.
 *
 * Every percentage is taken on `base.directCost`, never on a running total, so
 * two rules cannot produce different answers depending on which was entered
 * first.
 */
export function computeIndirectCosts(
  rules: readonly CostRule[],
  base: CostBase,
  ctx: CostRuleContext = {},
): IndirectCostResult {
  const applied: AppliedCostRule[] = [];
  const skipped: IndirectCostResult['skipped'] = [];

  for (const rule of applicableRules(rules, ctx)) {
    let amount: number | null = null;
    let basis = 0;

    switch (rule.method) {
      case 'PERCENT_OF_DIRECT_COST':
        basis = base.directCost;
        amount = (base.directCost * rule.value) / 100;
        break;

      case 'PERCENT_OF_REVENUE':
        // Computed against the price as it already stands. Recomputing the
        // price from the new cost would feed the rule its own output.
        if (base.sellingPrice <= 0) {
          skipped.push({ ruleId: rule.id, name: rule.name, reason: 'NO_SELLING_PRICE' });
          continue;
        }
        basis = base.sellingPrice;
        amount = (base.sellingPrice * rule.value) / 100;
        break;

      case 'FIXED_AMOUNT':
        basis = 0;
        amount = rule.value;
        break;

      case 'MONTHLY_RATE':
        if (!base.durationMonths || base.durationMonths <= 0) {
          // A monthly overhead with no duration is not zero — it is unknown,
          // and pretending otherwise understates the bid.
          skipped.push({ ruleId: rule.id, name: rule.name, reason: 'NO_DURATION' });
          continue;
        }
        basis = base.durationMonths;
        amount = rule.value * base.durationMonths;
        break;
    }

    applied.push({
      ruleId: rule.id,
      name: rule.name,
      category: rule.category,
      method: rule.method,
      value: rule.value,
      amount: round(amount),
      basis: round(basis),
    });
  }

  const byCategory = Object.fromEntries(
    COST_RULE_CATEGORIES.map((c) => [
      c,
      round(applied.filter((a) => a.category === c).reduce((s, a) => s + a.amount, 0)),
    ]),
  ) as Record<CostRuleCategory, number>;

  return {
    applied,
    byCategory,
    total: round(applied.reduce((s, a) => s + a.amount, 0)),
    skipped,
  };
}

export interface FullCostTotals {
  directCost: number;
  indirectCost: number;
  /** Direct plus every approved rule that applied. */
  totalCost: number;
  sellingPrice: number;
  grossProfit: number;
  marginPercent: number;
  byCategory: Record<CostRuleCategory, number>;
}

/**
 * The summary bar the spec's Costing Builder asks for: direct, indirect,
 * financial, risk, G&A, total cost, price, profit and margin.
 *
 * Margin is over price and never over cost, the same as everywhere else — the
 * one arithmetic distinction this system refuses to blur.
 */
export function fullCostTotals(
  rules: readonly CostRule[],
  base: CostBase,
  ctx: CostRuleContext = {},
): FullCostTotals {
  const indirect = computeIndirectCosts(rules, base, ctx);
  const totalCost = round(base.directCost + indirect.total);
  const grossProfit = round(base.sellingPrice - totalCost);

  return {
    directCost: round(base.directCost),
    indirectCost: indirect.total,
    totalCost,
    sellingPrice: round(base.sellingPrice),
    grossProfit,
    marginPercent:
      base.sellingPrice > 0 ? round((grossProfit / base.sellingPrice) * 100) : 0,
    byCategory: indirect.byCategory,
  };
}
