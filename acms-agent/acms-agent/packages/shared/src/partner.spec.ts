import {
  DEFAULT_QUOTATION_WEIGHTS,
  compareQuotations,
  isQuotationExpired,
  landedCost,
  quotationWeightsTotal,
  weightedQuotationScore,
  type ComparableQuotation,
} from './partner';

const NOW = new Date('2026-08-01T00:00:00.000Z');

function q(over: Partial<ComparableQuotation> & { id: string }): ComparableQuotation {
  return {
    partnerId: `p-${over.id}`,
    partnerName: `Partner ${over.id}`,
    totalValue: 100_000,
    ...over,
  };
}

describe('quotation weights', () => {
  it('ships a default split totalling 100', () => {
    expect(quotationWeightsTotal(DEFAULT_QUOTATION_WEIGHTS)).toBe(100);
  });

  it('counts an unscored dimension as zero, so a half-done review cannot flatter', () => {
    const full = weightedQuotationScore({
      PRICE: 5,
      TECHNICAL: 5,
      DELIVERY: 5,
      PAYMENT: 5,
      QUALITY: 5,
      RISK: 5,
    });
    const partial = weightedQuotationScore({ PRICE: 5, TECHNICAL: 5 });

    expect(full).toBeCloseTo(100, 5);
    // Price 30 + technical 25 out of 100 — not 100% of the two that were scored.
    expect(partial).toBeCloseTo(55, 5);
  });

  it('never divides by zero when every weight is zero', () => {
    expect(
      weightedQuotationScore({ PRICE: 5 }, {
        PRICE: 0,
        TECHNICAL: 0,
        DELIVERY: 0,
        PAYMENT: 0,
        QUALITY: 0,
        RISK: 0,
      }),
    ).toBe(0);
  });
});

describe('landed cost', () => {
  it('adds freight and duty to the quoted price', () => {
    expect(landedCost(q({ id: 'a', totalValue: 100, landedAdjustment: 25 }))).toBe(125);
  });

  it('equals the quoted price when nothing was added', () => {
    expect(landedCost(q({ id: 'a', totalValue: 100 }))).toBe(100);
  });
});

describe('comparing quotations', () => {
  // The case the spec is guarding against: the cheapest offer is neither the
  // cheapest delivered nor the best technically, and picking it automatically
  // would be wrong three ways.
  const offers = [
    q({ id: 'cheap', totalValue: 90_000, landedAdjustment: 30_000, technicalScore: 2, weightedScore: 55 }),
    q({ id: 'balanced', totalValue: 100_000, landedAdjustment: 5_000, technicalScore: 4, weightedScore: 82 }),
    q({ id: 'premium', totalValue: 120_000, landedAdjustment: 2_000, technicalScore: 5, weightedScore: 78 }),
  ];

  it('reports four different winners rather than one', () => {
    const c = compareQuotations(offers, NOW);

    expect(c.lowestPriceId).toBe('cheap');
    expect(c.lowestLandedCostId).toBe('balanced');
    expect(c.bestTechnicalId).toBe('premium');
    expect(c.bestOverallValueId).toBe('balanced');
  });

  it('recommends overall value, never the cheapest', () => {
    const c = compareQuotations(offers, NOW);

    expect(c.recommendedId).toBe('balanced');
    expect(c.recommendedId).not.toBe(c.lowestPriceId);
  });

  it('excludes a blacklisted partner and says why', () => {
    const c = compareQuotations(
      [q({ id: 'banned', totalValue: 10, blacklisted: true }), ...offers],
      NOW,
    );

    expect(c.lowestPriceId).not.toBe('banned');
    expect(c.ineligible).toContainEqual({ id: 'banned', reason: 'PARTNER_BLACKLISTED' });
  });

  it('excludes a suspended partner', () => {
    const c = compareQuotations(
      [q({ id: 'susp', totalValue: 10, approvalStatus: 'SUSPENDED' }), ...offers],
      NOW,
    );

    expect(c.ineligible).toContainEqual({ id: 'susp', reason: 'PARTNER_SUSPENDED' });
  });

  it('excludes an expired quotation — an old price is not a current offer', () => {
    const c = compareQuotations(
      [q({ id: 'stale', totalValue: 10, validUntil: '2026-07-01T00:00:00.000Z' }), ...offers],
      NOW,
    );

    expect(c.lowestPriceId).toBe('cheap');
    expect(c.ineligible).toContainEqual({ id: 'stale', reason: 'QUOTATION_EXPIRED' });
  });

  it('keeps a quotation valid on its final day', () => {
    const c = compareQuotations(
      [q({ id: 'today', totalValue: 10, validUntil: NOW.toISOString() })],
      NOW,
    );

    expect(c.ineligible).toHaveLength(0);
    expect(c.lowestPriceId).toBe('today');
  });

  it('returns nothing rather than inventing a winner when every offer is excluded', () => {
    const c = compareQuotations([q({ id: 'banned', blacklisted: true })], NOW);

    expect(c.recommendedId).toBeNull();
    expect(c.lowestPriceId).toBeNull();
    expect(c.ineligible).toHaveLength(1);
  });

  it('ignores an offer for a view it cannot answer, without dropping it entirely', () => {
    // No technical score recorded yet: it cannot win "best technical", but it
    // is still the cheapest and must show up as such.
    const c = compareQuotations(
      [q({ id: 'unscored', totalValue: 10 }), q({ id: 'scored', totalValue: 500, technicalScore: 3 })],
      NOW,
    );

    expect(c.lowestPriceId).toBe('unscored');
    expect(c.bestTechnicalId).toBe('scored');
    expect(c.ineligible).toHaveLength(0);
  });
});

describe('quotation validity', () => {
  it('treats a missing expiry as open-ended rather than expired', () => {
    expect(isQuotationExpired(null, NOW)).toBe(false);
  });

  it('flags a date in the past', () => {
    expect(isQuotationExpired('2026-01-01', NOW)).toBe(true);
  });
});
