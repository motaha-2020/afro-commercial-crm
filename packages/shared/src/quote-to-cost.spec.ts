import { COST_SOURCES, COST_SOURCE_CONFIDENCE, type CostSource } from './costing';
import {
  SUPERSEDED_BY_QUOTE,
  SURVIVES_A_QUOTE,
  costSourceForPartner,
  isSupersededByQuote,
  reachedTheCosting,
} from './quote-to-cost';

describe('what a supplier quote replaces', () => {
  it('every cost source is classified exactly once', () => {
    // The point of the exhaustiveness check: an unclassified source would fall
    // through to "additive" at the call site and inflate the bid by the amount
    // of the estimate the quote was supposed to replace.
    const classified = [...SUPERSEDED_BY_QUOTE, ...SURVIVES_A_QUOTE].sort();
    expect(classified).toEqual([...COST_SOURCES].sort());
    expect(new Set(classified).size).toBe(COST_SOURCES.length);
  });

  it('displaces guesses about the price of the same thing', () => {
    expect(isSupersededByQuote('MANUAL_ESTIMATE')).toBe(true);
    expect(isSupersededByQuote('HISTORICAL_RATE')).toBe(true);
    expect(isSupersededByQuote('MARKET_BENCHMARK')).toBe(true);
  });

  it('displaces an earlier quote, so re-selecting does not stack two prices', () => {
    expect(isSupersededByQuote('VENDOR_QUOTE')).toBe(true);
    expect(isSupersededByQuote('SUBCONTRACTOR_QUOTE')).toBe(true);
  });

  it('leaves our own cost and money already committed alone', () => {
    // A subcontractor quoting the install does not tell us our supervision
    // costs nothing.
    expect(isSupersededByQuote('INTERNAL_RATE')).toBe(false);
    expect(isSupersededByQuote('ERP_PURCHASE_PRICE')).toBe(false);
  });

  it('never displaces a source it trusts more than a quote', () => {
    // A stronger invariant than the list itself: if some future edit put a
    // high-confidence source on the superseded list, this fails.
    for (const source of SUPERSEDED_BY_QUOTE) {
      expect(COST_SOURCE_CONFIDENCE[source]).toBeLessThanOrEqual(
        COST_SOURCE_CONFIDENCE.VENDOR_QUOTE,
      );
    }
  });
});

describe('which kind of evidence the quote is', () => {
  it('a supplier quote is a vendor quote', () => {
    expect(costSourceForPartner(['SUPPLIER'])).toBe('VENDOR_QUOTE');
  });

  it('a subcontractor quote is recorded as one', () => {
    expect(costSourceForPartner(['SUBCONTRACTOR'])).toBe('SUBCONTRACTOR_QUOTE');
  });

  it('a company that does both counts as the subcontractor — the riskier half', () => {
    // Section 21's ordinary case: one partner, both roles.
    expect(costSourceForPartner(['SUPPLIER', 'SUBCONTRACTOR'])).toBe('SUBCONTRACTOR_QUOTE');
  });

  it('any other role still yields a usable source rather than throwing', () => {
    expect(COST_SOURCES).toContain(costSourceForPartner(['LOGISTICS_PROVIDER']) as CostSource);
  });
});

describe('reporting what happened', () => {
  const empty = { applied: 0, superseded: 0, retained: 0, skipped: [] };

  it('a selection that reached nothing is not reported as a costing change', () => {
    expect(reachedTheCosting(empty)).toBe(false);
    expect(
      reachedTheCosting({ ...empty, skipped: [{ reason: 'COSTING_LOCKED', count: 3 }] }),
    ).toBe(false);
  });

  it('superseding without applying is still not a change worth claiming', () => {
    expect(reachedTheCosting({ ...empty, superseded: 2 })).toBe(false);
  });

  it('one applied line is', () => {
    expect(reachedTheCosting({ ...empty, applied: 1 })).toBe(true);
  });
});
