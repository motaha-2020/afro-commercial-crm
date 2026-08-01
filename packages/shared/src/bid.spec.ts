import {
  suggestDecisionWithBands,
  BID_SCORE_FACTORS,
  BID_SCORE_FACTOR_DEFINITIONS,
  bidScore,
  defaultWeights,
  suggestDecision,
  unratedFactors,
  validateWeights,
} from './bid';

describe('bid score weights', () => {
  it('ships the spec’s eight factors totalling 100', () => {
    expect(BID_SCORE_FACTOR_DEFINITIONS).toHaveLength(8);
    const total = BID_SCORE_FACTOR_DEFINITIONS.reduce((s, f) => s + f.defaultWeight, 0);
    expect(total).toBe(100);
  });

  it('accepts a re-weighting that still totals 100', () => {
    const w = { ...defaultWeights(), RELATIONSHIP_STRENGTH: 25, COMPETITION: 0 };
    expect(validateWeights(w)).toEqual([]);
  });

  it('refuses weights that do not total 100', () => {
    const w = { ...defaultWeights(), TECHNICAL_FIT: 40 };
    expect(validateWeights(w).map((i) => i.code)).toContain('WRONG_TOTAL');
  });

  it('refuses a dropped factor, so nobody can score on seven', () => {
    const w = { ...defaultWeights() } as Record<string, number>;
    delete w.COMPETITION;
    expect(validateWeights(w).map((i) => i.code)).toContain('MISSING_FACTOR');
  });

  it('refuses invented factors and negative weights', () => {
    const codes = validateWeights({ ...defaultWeights(), FRIENDLINESS: -5 }).map((i) => i.code);
    expect(codes).toContain('UNKNOWN_FACTOR');
    expect(codes).toContain('NEGATIVE_WEIGHT');
  });
});

describe('bid score', () => {
  const perfect = Object.fromEntries(BID_SCORE_FACTORS.map((f) => [f, 5]));
  const worst = Object.fromEntries(BID_SCORE_FACTORS.map((f) => [f, 0]));

  it('runs from 0 to 100', () => {
    expect(bidScore(perfect)).toBe(100);
    expect(bidScore(worst)).toBe(0);
  });

  it('scores a middling assessment at half marks', () => {
    const mid = Object.fromEntries(BID_SCORE_FACTORS.map((f) => [f, 2.5]));
    expect(bidScore(mid)).toBe(50);
  });

  it('weights the heavier factors more', () => {
    // Relationship (15) against payment terms (10): same rating, more score.
    expect(bidScore({ RELATIONSHIP_STRENGTH: 5 })).toBe(15);
    expect(bidScore({ PAYMENT_TERMS: 5 })).toBe(10);
  });

  it('treats an unrated factor as zero rather than skipping it', () => {
    // Averaging over rated factors only would let a half-finished assessment
    // score 100 — the opposite of what the score is for.
    expect(bidScore({ RELATIONSHIP_STRENGTH: 5 })).toBeLessThan(100);
    expect(unratedFactors({ RELATIONSHIP_STRENGTH: 5 })).toHaveLength(7);
  });

  it('clamps ratings outside the scale', () => {
    expect(bidScore({ ...worst, TECHNICAL_FIT: 99 })).toBe(15);
    expect(bidScore({ ...worst, TECHNICAL_FIT: -99 })).toBe(0);
  });

  it('honours custom weights', () => {
    const w = { ...defaultWeights(), RELATIONSHIP_STRENGTH: 25, COMPETITION: 0 };
    expect(bidScore({ RELATIONSHIP_STRENGTH: 5 }, w)).toBe(25);
    expect(bidScore({ COMPETITION: 5 }, w)).toBe(0);
  });
});

describe('decision suggestion', () => {
  it('moves through all four decisions as the score falls', () => {
    expect(suggestDecision(85)).toBe('BID');
    expect(suggestDecision(60)).toBe('BID_WITH_CONDITIONS');
    expect(suggestDecision(45)).toBe('HOLD');
    expect(suggestDecision(20)).toBe('NO_BID');
  });

  it('is a suggestion, never the recorded decision', () => {
    // Guards the intent: nothing here writes a decision, and the bands are
    // provisional until Afro Group states its real thresholds.
    expect(typeof suggestDecision(50)).toBe('string');
  });
});

describe('the Bid/No-Bid bands are Afro\'s to set', () => {
  it('suggests nothing at all when nobody has set them', () => {
    // The fallback is the whole problem: 70 shown beside a real score reads
    // like a company decision, and nobody at Afro chose it.
    const result = suggestDecisionWithBands(88, null);

    expect(result.decision).toBeNull();
    expect(result.configured).toBe(false);
  });

  it('follows the configured bands rather than the provisional ones', () => {
    const strict = suggestDecisionWithBands(72, { bid: 80, conditions: 60 });
    const loose = suggestDecisionWithBands(72, { bid: 70, conditions: 50 });

    // Same score, different company policy, different suggestion.
    expect(strict.decision).toBe('BID_WITH_CONDITIONS');
    expect(loose.decision).toBe('BID');
  });

  it('falls to NO_BID below the lower band', () => {
    expect(suggestDecisionWithBands(20, { bid: 70, conditions: 55 }).decision).toBe('NO_BID');
  });

  it('treats the band itself as inclusive', () => {
    expect(suggestDecisionWithBands(70, { bid: 70, conditions: 55 }).decision).toBe('BID');
    expect(suggestDecisionWithBands(55, { bid: 70, conditions: 55 }).decision).toBe(
      'BID_WITH_CONDITIONS',
    );
  });

  it('reports the bands it used, so a suggestion can be argued with', () => {
    const result = suggestDecisionWithBands(60, { bid: 70, conditions: 55 });

    expect(result.bands).toEqual({ bid: 70, conditions: 55 });
    expect(result.configured).toBe(true);
  });
});
