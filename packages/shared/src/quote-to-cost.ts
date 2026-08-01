/**
 * Release 5, second half — feeding a won quotation back into the costing.
 *
 * The reason Release 5 was worth building: the spec keeps `Cost Source` on
 * every cost line precisely so a reader can tell "مدى موثوقية السعر" — how much
 * a number can be trusted. A bid assembled from binding supplier quotes and one
 * assembled from guesses can carry an identical total and completely different
 * risk. Until a selected quotation actually reaches the cost breakdown, that
 * distinction stays theoretical: every line says MANUAL_ESTIMATE regardless of
 * how much real evidence procurement has gathered.
 *
 * The whole difficulty is in one question: when a supplier quotes a BOQ item
 * that already carries cost lines, which of those lines did the quote just
 * replace, and which are still genuinely owed on top of it?
 *
 * Getting that wrong is not a cosmetic bug. Keep too much and the item is
 * double-counted — the estimate we guessed plus the price we were quoted for
 * the same work. Keep too little and real cost silently disappears from the
 * bid. Both produce a confident, wrong number, which is the one outcome this
 * system is built to prevent. So the decision lives here, as data and pure
 * functions that can be tested and argued with, rather than inside a service
 * method where it would be invisible.
 */

import type { CostSource } from './costing';
import type { PartnerType } from './partner';

/**
 * Sources that are *an estimate of the price of the thing itself*. A supplier's
 * quote for that same thing answers the same question with better evidence, so
 * these are superseded rather than added to.
 */
export const SUPERSEDED_BY_QUOTE: readonly CostSource[] = [
  'MANUAL_ESTIMATE',
  'HISTORICAL_RATE',
  'MARKET_BENCHMARK',
  'VENDOR_QUOTE',
  'SUBCONTRACTOR_QUOTE',
] as const;

/**
 * Sources that answer a *different* question and therefore survive alongside a
 * quote. Our own crew rate is our cost of doing our part; a booked ERP purchase
 * price is money already committed. Neither is an opinion about what a supplier
 * would charge, so neither is displaced by learning what one actually charges.
 *
 * Keeping this list explicit — rather than "everything not in the other list" —
 * means adding a seventh cost source forces a deliberate choice about which
 * side it falls on, instead of defaulting silently into additive and quietly
 * inflating every bid that uses it.
 */
export const SURVIVES_A_QUOTE: readonly CostSource[] = [
  'INTERNAL_RATE',
  'ERP_PURCHASE_PRICE',
] as const;

export function isSupersededByQuote(source: CostSource): boolean {
  return SUPERSEDED_BY_QUOTE.includes(source);
}

/**
 * Which kind of evidence a quote from this partner represents. A company that
 * is registered as both — the ordinary case, per section 21 — is recorded as a
 * subcontractor quote, because when someone both supplies and installs, the
 * installation is the part carrying the commercial risk.
 */
export function costSourceForPartner(types: readonly PartnerType[]): CostSource {
  return types.includes('SUBCONTRACTOR') ? 'SUBCONTRACTOR_QUOTE' : 'VENDOR_QUOTE';
}

/**
 * Why a quotation line could not be written into the costing. Every one of
 * these is reported back by name: a line that silently fails to apply leaves
 * the bid priced on a guess while the screen says a quote was accepted.
 */
export const QUOTE_APPLICATION_SKIPS = [
  /** The quotation line was never mapped to a BOQ item, so there is no
   *  question it answers. Not an error — most freight and general lines are
   *  like this — but it must be visible, or a buyer will assume the whole
   *  quote landed in the costing. */
  'NOT_MAPPED_TO_BOQ',
  /** The costing version is approved and locked. The spec's rule is absolute:
   *  an approved costing is never edited. Procurement's decision still stands;
   *  carrying it into the numbers requires a new version, by a human. */
  'COSTING_LOCKED',
  /** The quotation is priced in a different currency from the costing
   *  scenario. Converting it here would invent an exchange rate and bury it in
   *  a cost line — worse than not applying it. */
  'CURRENCY_MISMATCH',
  /** The BOQ item belongs to a different opportunity than the quotation.
   *  Refused outright rather than reported as applied. */
  'BOQ_ITEM_FOREIGN',
] as const;
export type QuoteApplicationSkip = (typeof QUOTE_APPLICATION_SKIPS)[number];

export interface QuoteApplicationOutcome {
  /** Cost lines written from the quotation. */
  applied: number;
  /** Estimate lines the quote displaced, soft-deleted and audited. */
  superseded: number;
  /** Lines left in place because they answer a different question. */
  retained: number;
  skipped: { reason: QuoteApplicationSkip; count: number }[];
}

/**
 * Did anything actually reach the costing? Used to decide whether to tell the
 * user their cost confidence moved, or that the selection stands but the
 * numbers did not follow it.
 */
export function reachedTheCosting(outcome: QuoteApplicationOutcome): boolean {
  return outcome.applied > 0;
}
