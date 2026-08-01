/**
 * The Costing Builder's visual warnings.
 *
 * The spec calls this "أكثر شاشة تحتاج عناية" — the screen needing most care —
 * and lists the warnings it should raise: an item with no price, a cost from a
 * stale source, an expired vendor quote, a price below the historical average,
 * a negative margin, an old exchange rate, an implausible quantity, a
 * duplicated cost element.
 *
 * They live here rather than in the component for the usual reason: a warning
 * that only exists inside JSX cannot be tested, and these are the sentences an
 * estimator will trust or ignore. Each one has to be worth interrupting for.
 *
 * Two of the spec's eight are NOT implemented, and saying so is the point:
 *
 *   - "سعر أقل من متوسط تاريخي" needs a history of what similar work actually
 *     cost. The market price library exists as a table but nothing populates
 *     it, so the comparison would be against an empty set — a warning that
 *     never fires is worse than none, because its silence reads as assurance.
 *
 *   - "Exchange Rate قديم" needs dated FX rates in use on the costing. A
 *     scenario carries a currency and an exchangeRateDate, but no rate table
 *     is consulted, so there is nothing to call stale yet.
 *
 * Both are recorded in NOT_YET_COMPUTABLE so the screen can say which checks
 * it is not doing rather than implying it checked everything.
 */

import type { CostSource } from './costing';

export const COSTING_WARNING_CODES = [
  'NO_SELLING_PRICE',
  'NEGATIVE_MARGIN',
  'ZERO_OR_MISSING_QUANTITY',
  'NO_COST_LINES',
  'WEAK_COST_SOURCE',
  'EXPIRED_VENDOR_QUOTE',
  'DUPLICATE_COST_ELEMENT',
] as const;
export type CostingWarningCode = (typeof COSTING_WARNING_CODES)[number];

/** Warnings the spec asks for that cannot honestly be computed yet. */
export const NOT_YET_COMPUTABLE = [
  { code: 'BELOW_HISTORICAL_AVERAGE', needs: 'MARKET_PRICE_HISTORY' },
  { code: 'STALE_EXCHANGE_RATE', needs: 'DATED_FX_RATES' },
] as const;

export type WarningSeverity = 'BLOCKING' | 'HIGH' | 'INFO';

export interface CostingWarning {
  code: CostingWarningCode;
  severity: WarningSeverity;
  boqItemId: string;
  /** Extra context for the message, e.g. which element was duplicated. */
  detail?: string;
}

export interface WarnBreakdownLine {
  id: string;
  source: CostSource;
  totalCost: number;
  elementId?: string | null;
  /** The quotation this line came from, when it came from one. */
  quotationValidUntil?: Date | null;
}

export interface WarnBoqItem {
  id: string;
  quantity: number | null;
  internalCost: number | null;
  sellingTotal: number | null;
  breakdown: WarnBreakdownLine[];
}

/** Sources that are somebody's opinion rather than somebody's commitment. */
const WEAK_SOURCES: readonly CostSource[] = ['MANUAL_ESTIMATE', 'MARKET_BENCHMARK'] as const;

/**
 * How much of an item's cost may rest on opinion before it is worth saying so.
 *
 * Not zero: an estimate for a small ancillary line is normal and flagging it
 * would train people to ignore the colour. Set at half because that is the
 * point where the item's number stops being mostly evidence.
 */
export const WEAK_SOURCE_SHARE_LIMIT = 0.5;

export function warningsForItem(item: WarnBoqItem, asOf: Date = new Date()): CostingWarning[] {
  const found: CostingWarning[] = [];
  const at = (code: CostingWarningCode, severity: WarningSeverity, detail?: string) =>
    found.push({ code, severity, boqItemId: item.id, detail });

  if (item.quantity === null || item.quantity <= 0) {
    // A zero quantity silently zeroes the line's contribution to the bid.
    at('ZERO_OR_MISSING_QUANTITY', 'HIGH');
  }

  if (item.breakdown.length === 0) {
    at('NO_COST_LINES', 'HIGH');
  }

  const cost = item.internalCost ?? 0;
  const price = item.sellingTotal;

  if (price === null || price === 0) {
    // Priced at nothing while costing something is the classic way a bid ends
    // up under water without anyone noticing.
    if (cost > 0) at('NO_SELLING_PRICE', 'BLOCKING');
  } else if (price < cost) {
    at('NEGATIVE_MARGIN', 'BLOCKING');
  }

  const totalCost = item.breakdown.reduce((s, b) => s + b.totalCost, 0);
  if (totalCost > 0) {
    const weak = item.breakdown
      .filter((b) => WEAK_SOURCES.includes(b.source))
      .reduce((s, b) => s + b.totalCost, 0);
    if (weak / totalCost > WEAK_SOURCE_SHARE_LIMIT) {
      at('WEAK_COST_SOURCE', 'INFO', `${Math.round((weak / totalCost) * 100)}%`);
    }
  }

  for (const line of item.breakdown) {
    if (line.quotationValidUntil && line.quotationValidUntil < asOf) {
      // The number is still in the bid, but the offer behind it has lapsed:
      // the supplier is no longer held to it.
      at('EXPIRED_VENDOR_QUOTE', 'HIGH', line.id);
    }
  }

  // The same cost element twice on one item is usually a paste, and it double
  // counts silently — the total looks plausible because it is plausible.
  const seen = new Map<string, number>();
  for (const line of item.breakdown) {
    if (!line.elementId) continue;
    seen.set(line.elementId, (seen.get(line.elementId) ?? 0) + 1);
  }
  for (const [elementId, count] of seen) {
    if (count > 1) at('DUPLICATE_COST_ELEMENT', 'INFO', elementId);
  }

  return found;
}

export interface WarningSummary {
  warnings: CostingWarning[];
  blocking: number;
  high: number;
  info: number;
  /** Items carrying at least one warning, for the grid to mark. */
  byItem: Record<string, CostingWarning[]>;
}

export function warningsForVersion(
  items: readonly WarnBoqItem[],
  asOf: Date = new Date(),
): WarningSummary {
  const warnings = items.flatMap((item) => warningsForItem(item, asOf));

  const byItem: Record<string, CostingWarning[]> = {};
  for (const w of warnings) {
    (byItem[w.boqItemId] ??= []).push(w);
  }

  return {
    warnings,
    blocking: warnings.filter((w) => w.severity === 'BLOCKING').length,
    high: warnings.filter((w) => w.severity === 'HIGH').length,
    info: warnings.filter((w) => w.severity === 'INFO').length,
    byItem,
  };
}

/**
 * Whether a version has a problem that should stop it being submitted for
 * approval. Only BLOCKING counts: an approver's attention is finite and
 * spending it on an estimate share is how people learn to click through.
 */
export function hasBlockingWarning(summary: WarningSummary): boolean {
  return summary.blocking > 0;
}
