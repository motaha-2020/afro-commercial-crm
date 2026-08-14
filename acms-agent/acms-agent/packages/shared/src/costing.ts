/**
 * Release 4 — Costing and Pricing.
 *
 * This is the file the whole system exists to get right. The spec's warning is
 * blunt: margin is over selling price, markup is over cost, and confusing them
 * makes a company believe it is earning more than it is. Both live in
 * `opportunity.ts` already; everything here builds on them rather than
 * re-deriving a second, subtly different answer.
 */

import { marginPercent } from './opportunity';

/** The spec's five execution models. A pursuit may be priced under several. */
export const COSTING_SCENARIO_TYPES = [
  'SELF_EXECUTION',
  'FULL_SUBCONTRACTING',
  'MIXED_MODEL',
  'IMPORTED_MATERIALS',
  'LOCAL_MATERIALS',
] as const;
export type CostingScenarioType = (typeof COSTING_SCENARIO_TYPES)[number];

export const COSTING_VERSION_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
  'SUPERSEDED',
] as const;
export type CostingVersionStatus = (typeof COSTING_VERSION_STATUSES)[number];

export const COST_PACKAGE_TYPES = [
  'MATERIALS',
  'CIVIL_WORKS',
  'INSTALLATION',
  'PROJECT_MANAGEMENT',
  'LOGISTICS',
  'WARRANTY',
  'OTHER',
] as const;
export type CostPackageType = (typeof COST_PACKAGE_TYPES)[number];

/** The Cost Element Library's top level — free-text elements were the thing
 *  the spec set out to replace. */
export const COST_ELEMENT_CATEGORIES = [
  'DIRECT_MATERIAL',
  'DIRECT_LABOR',
  'EQUIPMENT',
  'VEHICLE',
  'SUBCONTRACTOR',
  'INDIRECT_COST',
  'FINANCIAL_COST',
  'CORPORATE',
  'PROFIT',
] as const;
export type CostElementCategory = (typeof COST_ELEMENT_CATEGORIES)[number];

export const RESOURCE_TYPES = [
  'MATERIAL',
  'LABOR',
  'EQUIPMENT',
  'VEHICLE',
  'SUBCONTRACT',
  'SERVICE',
] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

/**
 * Where a number came from. The spec keeps this precisely because it tells you
 * "مدى موثوقية السعر" — a bid built on binding quotes and one built on guesses
 * can carry the same total and completely different risk.
 */
export const COST_SOURCES = [
  'VENDOR_QUOTE',
  'SUBCONTRACTOR_QUOTE',
  'ERP_PURCHASE_PRICE',
  'HISTORICAL_RATE',
  'INTERNAL_RATE',
  'MARKET_BENCHMARK',
  'MANUAL_ESTIMATE',
] as const;
export type CostSource = (typeof COST_SOURCES)[number];

/**
 * How much weight a number of each kind deserves, 0..1. Quotes are commitments
 * from someone else; a manual estimate is an opinion. Used to report how much
 * of a bid is actually evidenced — never to alter a total.
 */
export const COST_SOURCE_CONFIDENCE: Record<CostSource, number> = {
  VENDOR_QUOTE: 1,
  SUBCONTRACTOR_QUOTE: 1,
  ERP_PURCHASE_PRICE: 0.9,
  HISTORICAL_RATE: 0.7,
  INTERNAL_RATE: 0.6,
  MARKET_BENCHMARK: 0.5,
  MANUAL_ESTIMATE: 0.3,
};

// ---------------------------------------------------------------------------
// Line-level cost
// ---------------------------------------------------------------------------

export interface CostLineInput {
  quantity: number;
  unitCost: number;
  /** Material lost in the doing — trimmed cable, broken tiles. Percent. */
  wastePercent?: number;
  /** Units produced per day; converts a quantity into crew-days when priced
   *  by time rather than by output. */
  productivityRate?: number;
  /** Rate to the costing currency. 1 when the resource is already in it. */
  exchangeRate?: number;
  taxAmount?: number;
  /** Share of the line charged to this item, for shared resources. Percent. */
  allocationPercent?: number;
}

function round(value: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round((value + Number.EPSILON) * f) / f;
}

/**
 * One breakdown line's total cost.
 *
 * Order matters and is deliberate: waste inflates the quantity actually bought,
 * productivity converts output into resource-time, the exchange rate lands it in
 * the costing currency, allocation takes this item's share, and tax is added
 * last because it is charged on the converted, allocated amount — not on a
 * foreign-currency figure nobody will ever pay.
 */
export function costLineTotal(input: CostLineInput): number {
  const {
    quantity,
    unitCost,
    wastePercent = 0,
    productivityRate,
    exchangeRate = 1,
    taxAmount = 0,
    allocationPercent = 100,
  } = input;

  if (!Number.isFinite(quantity) || !Number.isFinite(unitCost)) return 0;

  const withWaste = quantity * (1 + wastePercent / 100);
  // A productivity rate of zero would mean "produces nothing", which cannot be
  // costed; treat it as unset rather than dividing by zero.
  const effective =
    productivityRate && productivityRate > 0 ? withWaste / productivityRate : withWaste;

  const direct = effective * unitCost * exchangeRate;
  const allocated = direct * (allocationPercent / 100);

  return round(allocated + taxAmount);
}

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

/**
 * The selling price that yields a target MARGIN (over price), not markup.
 *
 * price = cost / (1 - margin). A target of 100% or more has no finite answer —
 * you cannot make all of the price be profit — so it is rejected rather than
 * returning Infinity for someone to print in a proposal.
 */
export function priceForTargetMargin(cost: number, targetMarginPercent: number): number {
  if (!Number.isFinite(cost) || cost < 0) return 0;
  if (targetMarginPercent >= 100 || targetMarginPercent <= -Infinity) {
    throw new RangeError('A target margin of 100% or more is unreachable at any price');
  }
  return round(cost / (1 - targetMarginPercent / 100));
}

/** The selling price that yields a target MARKUP (over cost). */
export function priceForTargetMarkup(cost: number, targetMarkupPercent: number): number {
  if (!Number.isFinite(cost) || cost < 0) return 0;
  return round(cost * (1 + targetMarkupPercent / 100));
}

export interface RollupLine {
  cost: number;
  price: number;
}

export interface Rollup {
  totalCost: number;
  totalPrice: number;
  grossProfit: number;
  /** Over selling price. The number the spec insists people mean. */
  marginPercent: number;
  /** Over cost. Shown beside it so the two can never be silently swapped. */
  markupPercent: number;
}

export function rollup(lines: readonly RollupLine[]): Rollup {
  const totalCost = round(lines.reduce((s, l) => s + (l.cost || 0), 0));
  const totalPrice = round(lines.reduce((s, l) => s + (l.price || 0), 0));
  const grossProfit = round(totalPrice - totalCost);

  return {
    totalCost,
    totalPrice,
    grossProfit,
    marginPercent: round(marginPercent(totalCost, totalPrice)),
    // Not markupPercent() from opportunity.ts by accident: that helper takes
    // (cost, price) too, and reusing it keeps one definition of each.
    markupPercent: totalCost > 0 ? round((grossProfit / totalCost) * 100) : 0,
  };
}

// ---------------------------------------------------------------------------
// How much of a bid is actually evidenced
// ---------------------------------------------------------------------------

export interface ConfidenceInput {
  cost: number;
  source: CostSource;
}

export interface CostConfidence {
  /** 0..100, cost-weighted. A cheap guess barely moves it; a guessed-at
   *  subcontract package moves it a lot. */
  score: number;
  quotedShare: number;
  estimatedShare: number;
  bySource: Partial<Record<CostSource, number>>;
}

/**
 * Weighted by money, not by line count — a hundred confidently-priced bolts do
 * not make up for one guessed-at civil works package.
 */
export function costConfidence(lines: readonly ConfidenceInput[]): CostConfidence {
  const total = lines.reduce((s, l) => s + (l.cost || 0), 0);
  const bySource: Partial<Record<CostSource, number>> = {};
  for (const line of lines) {
    bySource[line.source] = round((bySource[line.source] ?? 0) + (line.cost || 0));
  }

  if (total <= 0) {
    return { score: 0, quotedShare: 0, estimatedShare: 0, bySource };
  }

  const weighted = lines.reduce(
    (s, l) => s + (l.cost || 0) * (COST_SOURCE_CONFIDENCE[l.source] ?? 0),
    0,
  );
  const quoted = lines
    .filter((l) => l.source === 'VENDOR_QUOTE' || l.source === 'SUBCONTRACTOR_QUOTE')
    .reduce((s, l) => s + (l.cost || 0), 0);
  const estimated = lines
    .filter((l) => l.source === 'MANUAL_ESTIMATE')
    .reduce((s, l) => s + (l.cost || 0), 0);

  return {
    score: round((weighted / total) * 100),
    quotedShare: round((quoted / total) * 100),
    estimatedShare: round((estimated / total) * 100),
    bySource,
  };
}

/**
 * A price is only priced once its cost is known. Reported rather than enforced:
 * an early indicative number is legitimate, but it should never be mistaken for
 * a costed one.
 */
export function isPricedWithoutCost(cost: number, price: number): boolean {
  return price > 0 && cost <= 0;
}
