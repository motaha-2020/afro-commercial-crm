/**
 * Tax rules.
 *
 * Section 19's principle governs here exactly as it governs indirect costs:
 * the system does not decide the accounting treatment, it applies rules that
 * Finance approved. A draft tax rule is a proposal and never touches a bid.
 *
 * Kept apart from CostRule rather than folded into its TAXES category, because
 * a tax is not an overhead in the one respect that matters to the arithmetic:
 * an overhead is money the company spends and must earn back, while VAT is
 * money that passes through it. Adding both to one total would quietly make a
 * healthy margin look thin and, worse, make a thin one look survivable.
 */

export const TAX_TYPES = [
  'VAT',
  'WITHHOLDING',
  'CUSTOMS_DUTY',
  'STAMP_DUTY',
  'SOCIAL_INSURANCE',
  'OTHER',
] as const;
export type TaxType = (typeof TAX_TYPES)[number];

/**
 * What the rate is applied to.
 *
 * The reason this exists rather than a single "amount": withholding is deducted
 * from what a subcontractor is paid, VAT is charged on what the customer is
 * billed, and customs duty lands on imported materials alone. A tax layer with
 * one base can express none of the three honestly.
 */
export const TAX_BASES = [
  'SELLING_PRICE',
  'DIRECT_COST',
  'SUBCONTRACTOR_PAYMENTS',
  'IMPORTED_MATERIALS',
] as const;
export type TaxBase = (typeof TAX_BASES)[number];

export interface TaxRule {
  id: string;
  name: string;
  taxType: TaxType;
  base: TaxBase;
  /** Percent. A tax expressed as a fixed sum belongs in a cost rule, not here. */
  ratePercent: number;
  /** True when the company recovers it — VAT on inputs, typically. */
  isRecoverable: boolean;
  country?: string | null;
  orgUnitId?: string | null;
  effectiveFrom: Date | string;
  effectiveTo?: Date | string | null;
  approvalStatus: 'DRAFT' | 'APPROVED' | 'REJECTED';
}

export interface TaxContext {
  country?: string | null;
  orgUnitId?: string | null;
  asOf?: Date;
}

export interface TaxBaseAmounts {
  sellingPrice: number;
  directCost: number;
  subcontractorPayments: number;
  importedMaterials: number;
}

export interface AppliedTax {
  ruleId: string;
  name: string;
  taxType: TaxType;
  base: TaxBase;
  ratePercent: number;
  basis: number;
  amount: number;
  isRecoverable: boolean;
}

export interface TaxResult {
  applied: AppliedTax[];
  /** What the project actually bears: recoverable taxes are excluded. */
  borne: number;
  /** Everything computed, recoverable or not — what appears on invoices. */
  total: number;
  byType: Record<string, number>;
  skipped: { ruleId: string; name: string; reason: string }[];
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Which rules are in force for this scope and date.
 *
 * Same shape as the cost rules: a rule scoped to a country beats an unscoped
 * one, only APPROVED rules count, and a rule whose window has closed is
 * ignored rather than quietly reused — last year's VAT rate is not this year's.
 */
export function applicableTaxRules(
  rules: readonly TaxRule[],
  ctx: TaxContext = {},
): TaxRule[] {
  const asOf = ctx.asOf ?? new Date();

  const live = rules.filter((rule) => {
    if (rule.approvalStatus !== 'APPROVED') return false;
    if (new Date(rule.effectiveFrom).getTime() > asOf.getTime()) return false;
    if (rule.effectiveTo && new Date(rule.effectiveTo).getTime() < asOf.getTime()) return false;
    if (rule.country && rule.country !== ctx.country) return false;
    if (rule.orgUnitId && rule.orgUnitId !== ctx.orgUnitId) return false;
    return true;
  });

  // Narrowest scope wins per (type, base): a country-specific VAT rule replaces
  // the group-wide one rather than being charged on top of it.
  const best = new Map<string, TaxRule>();
  for (const rule of live) {
    const key = `${rule.taxType}:${rule.base}`;
    const current = best.get(key);
    if (!current || specificity(rule) > specificity(current)) best.set(key, rule);
  }
  return [...best.values()];
}

function specificity(rule: TaxRule): number {
  return (rule.orgUnitId ? 2 : 0) + (rule.country ? 1 : 0);
}

export function computeTaxes(
  rules: readonly TaxRule[],
  amounts: TaxBaseAmounts,
  ctx: TaxContext = {},
): TaxResult {
  const applied: AppliedTax[] = [];
  const skipped: TaxResult['skipped'] = [];

  for (const rule of applicableTaxRules(rules, ctx)) {
    const basis = basisFor(rule.base, amounts);

    // A base of zero is not a tax of zero: it means the thing being taxed is
    // not in this costing at all, and saying "0" implies it was considered and
    // came to nothing.
    if (basis <= 0) {
      skipped.push({ ruleId: rule.id, name: rule.name, reason: `NO_${rule.base}` });
      continue;
    }

    const amount = round((basis * rule.ratePercent) / 100);
    applied.push({
      ruleId: rule.id,
      name: rule.name,
      taxType: rule.taxType,
      base: rule.base,
      ratePercent: rule.ratePercent,
      basis: round(basis),
      amount,
      isRecoverable: rule.isRecoverable,
    });
  }

  const byType: Record<string, number> = {};
  for (const a of applied) {
    byType[a.taxType] = round((byType[a.taxType] ?? 0) + a.amount);
  }

  return {
    applied,
    total: round(applied.reduce((sum, a) => sum + a.amount, 0)),
    borne: round(
      applied.filter((a) => !a.isRecoverable).reduce((sum, a) => sum + a.amount, 0),
    ),
    byType,
    skipped,
  };
}

function basisFor(base: TaxBase, amounts: TaxBaseAmounts): number {
  switch (base) {
    case 'SELLING_PRICE':
      return amounts.sellingPrice;
    case 'DIRECT_COST':
      return amounts.directCost;
    case 'SUBCONTRACTOR_PAYMENTS':
      return amounts.subcontractorPayments;
    case 'IMPORTED_MATERIALS':
      return amounts.importedMaterials;
    default: {
      const exhaustive: never = base;
      throw new Error(`Unhandled tax base: ${String(exhaustive)}`);
    }
  }
}
