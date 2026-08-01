/**
 * Release 5 — Partners and Quotations.
 *
 * The spec settles the modelling question itself (section 21): "يمكن أن يكون
 * المورد والمقاول داخل جدول Business Partner واحد مع أنواع مختلفة" — supplier
 * and subcontractor live in ONE Business Partner table with different types.
 * That is why types are rows rather than a column: the company that sells you
 * the cable and also installs it is one relationship, one performance history,
 * one set of ratings — not two half-records that never add up.
 *
 * The rule this release exists to protect is section 23's: "يجب ألا يختار
 * النظام أقل سعر تلقائيًا" — the system must never auto-select the cheapest
 * quotation. It presents several distinct readings of the same offers and a
 * person decides. Everything below is built so that decision cannot be
 * quietly reduced to one number.
 */

export const PARTNER_TYPES = [
  'SUPPLIER',
  'SUBCONTRACTOR',
  'CONSULTANT',
  'LOCAL_PARTNER',
  'LOGISTICS_PROVIDER',
  'EQUIPMENT_RENTAL',
] as const;
export type PartnerType = (typeof PARTNER_TYPES)[number];

/**
 * Approval is a state of the relationship, not of a document. A partner may be
 * usable for quoting long before they are cleared to be awarded work.
 */
export const PARTNER_APPROVAL_STATUSES = [
  'PROSPECT',
  'UNDER_QUALIFICATION',
  'APPROVED',
  'CONDITIONAL',
  'SUSPENDED',
] as const;
export type PartnerApprovalStatus = (typeof PARTNER_APPROVAL_STATUSES)[number];

/**
 * The four ratings the spec names, kept as four independent readings. Averaging
 * them into one score is the same mistake as collapsing an opportunity's stage
 * and status: a partner who is technically excellent and financially fragile is
 * not "medium", they are a specific risk that a single number hides.
 */
export const PARTNER_RATING_DIMENSIONS = [
  'TECHNICAL',
  'COMMERCIAL',
  'FINANCIAL',
  'HSE',
] as const;
export type PartnerRatingDimension = (typeof PARTNER_RATING_DIMENSIONS)[number];

/** Ratings run 0–5, matching the Bid/No-Bid scale already in use. */
export const PARTNER_RATING_MIN = 0;
export const PARTNER_RATING_MAX = 5;

export const QUOTATION_TECHNICAL_STATUSES = [
  'NOT_REVIEWED',
  'COMPLIANT',
  'COMPLIANT_WITH_DEVIATIONS',
  'NON_COMPLIANT',
] as const;
export type QuotationTechnicalStatus = (typeof QUOTATION_TECHNICAL_STATUSES)[number];

export const QUOTATION_COMMERCIAL_STATUSES = [
  'NOT_REVIEWED',
  'ACCEPTABLE',
  'NEEDS_NEGOTIATION',
  'UNACCEPTABLE',
] as const;
export type QuotationCommercialStatus = (typeof QUOTATION_COMMERCIAL_STATUSES)[number];

/** How a line answers the BOQ item it was asked to price. */
export const QUOTATION_COMPLIANCES = ['COMPLIANT', 'ALTERNATIVE', 'DEVIATION', 'NOT_QUOTED'] as const;
export type QuotationCompliance = (typeof QUOTATION_COMPLIANCES)[number];

export const RFQ_STATUSES = ['DRAFT', 'ISSUED', 'CLOSED', 'CANCELLED'] as const;
export type RfqStatus = (typeof RFQ_STATUSES)[number];

/**
 * Evaluation dimensions from section 23, with the weights the spec implies by
 * listing price and technical first. Like the Bid/No-Bid weights these are
 * INDICATIVE and stored on each evaluation, so an old comparison stays
 * readable with the weights that actually produced it.
 */
export const QUOTATION_SCORE_DIMENSIONS = [
  'PRICE',
  'TECHNICAL',
  'DELIVERY',
  'PAYMENT',
  'QUALITY',
  'RISK',
] as const;
export type QuotationScoreDimension = (typeof QUOTATION_SCORE_DIMENSIONS)[number];

export const DEFAULT_QUOTATION_WEIGHTS: Record<QuotationScoreDimension, number> = {
  PRICE: 30,
  TECHNICAL: 25,
  DELIVERY: 15,
  PAYMENT: 10,
  QUALITY: 10,
  RISK: 10,
};

export function quotationWeightsTotal(weights: Record<string, number>): number {
  return Object.values(weights).reduce((sum, w) => sum + w, 0);
}

/**
 * Weighted score out of 100 from 0–5 ratings.
 *
 * An unscored dimension counts as ZERO rather than being dropped from the
 * denominator — the same decision taken for Bid/No-Bid factors. A half-finished
 * evaluation must not flatter an offer by quietly shrinking what it is measured
 * against.
 */
export function weightedQuotationScore(
  scores: Partial<Record<QuotationScoreDimension, number>>,
  weights: Record<QuotationScoreDimension, number> = DEFAULT_QUOTATION_WEIGHTS,
): number {
  const total = quotationWeightsTotal(weights);
  if (total <= 0) return 0;

  let earned = 0;
  for (const dim of QUOTATION_SCORE_DIMENSIONS) {
    const rating = scores[dim] ?? 0;
    earned += (rating / PARTNER_RATING_MAX) * weights[dim];
  }
  return (earned / total) * 100;
}

export interface ComparableQuotation {
  id: string;
  partnerId: string;
  partnerName: string;
  /** Quoted total in the comparison currency. */
  totalValue: number;
  /**
   * Everything that lands the goods on site beyond the quoted price — freight,
   * duty, handling. The cheapest quotation is regularly not the cheapest
   * delivered cost, which is exactly why the spec asks for both.
   */
  landedAdjustment?: number;
  technicalScore?: number;
  weightedScore?: number;
  deliveryDays?: number;
  validUntil?: string | null;
  blacklisted?: boolean;
  approvalStatus?: PartnerApprovalStatus;
}

export interface QuotationComparison {
  lowestPriceId: string | null;
  lowestLandedCostId: string | null;
  bestTechnicalId: string | null;
  bestOverallValueId: string | null;
  /**
   * The single offer the system puts forward — best overall value, never
   * cheapest. Null when no offer is eligible at all.
   */
  recommendedId: string | null;
  /** Offers excluded from every view, each with the reason it was excluded. */
  ineligible: { id: string; reason: string }[];
}

export function landedCost(q: ComparableQuotation): number {
  return q.totalValue + (q.landedAdjustment ?? 0);
}

/**
 * Produces the spec's several readings of the same set of offers.
 *
 * It deliberately returns FOUR different winners plus a recommendation rather
 * than one answer. If they all coincide the choice is easy; when they disagree
 * — the usual case — the disagreement is the information, and hiding it behind
 * an automatic "winner" is precisely what the spec forbids.
 *
 * Blacklisted or suspended partners and expired quotations are excluded from
 * every view and listed with their reason, so an offer never vanishes without
 * explanation.
 */
export function compareQuotations(
  quotations: ComparableQuotation[],
  asOf: Date,
): QuotationComparison {
  const ineligible: { id: string; reason: string }[] = [];
  const eligible: ComparableQuotation[] = [];

  for (const q of quotations) {
    if (q.blacklisted) {
      ineligible.push({ id: q.id, reason: 'PARTNER_BLACKLISTED' });
      continue;
    }
    if (q.approvalStatus === 'SUSPENDED') {
      ineligible.push({ id: q.id, reason: 'PARTNER_SUSPENDED' });
      continue;
    }
    if (q.validUntil && new Date(q.validUntil).getTime() < asOf.getTime()) {
      ineligible.push({ id: q.id, reason: 'QUOTATION_EXPIRED' });
      continue;
    }
    eligible.push(q);
  }

  const best = (
    pick: (q: ComparableQuotation) => number | undefined,
    direction: 'min' | 'max',
  ): string | null => {
    let winner: ComparableQuotation | null = null;
    let winning = 0;
    for (const q of eligible) {
      const value = pick(q);
      if (value === undefined || Number.isNaN(value)) continue;
      if (
        winner === null ||
        (direction === 'min' ? value < winning : value > winning)
      ) {
        winner = q;
        winning = value;
      }
    }
    return winner?.id ?? null;
  };

  const bestOverallValueId = best((q) => q.weightedScore, 'max');

  return {
    lowestPriceId: best((q) => q.totalValue, 'min'),
    lowestLandedCostId: best((q) => landedCost(q), 'min'),
    bestTechnicalId: best((q) => q.technicalScore, 'max'),
    bestOverallValueId,
    // The recommendation follows overall value, not price. A person may still
    // choose otherwise; departing from it is what requires a written reason.
    recommendedId: bestOverallValueId,
    ineligible,
  };
}

export function isQuotationExpired(validUntil: string | Date | null | undefined, asOf: Date): boolean {
  if (!validUntil) return false;
  const until = typeof validUntil === 'string' ? new Date(validUntil) : validUntil;
  return until.getTime() < asOf.getTime();
}
