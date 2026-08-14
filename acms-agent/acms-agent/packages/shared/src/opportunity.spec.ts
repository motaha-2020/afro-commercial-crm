import { marginPercent, markupPercent, STAGE_ORDER, STAGE_EXIT_REQUIREMENTS } from './opportunity';

describe('margin vs markup', () => {
  // The spec's own worked example: cost 100, price 125.
  it('computes margin over selling price', () => {
    expect(marginPercent(100, 125)).toBeCloseTo(20, 5);
  });

  it('computes markup over cost', () => {
    expect(markupPercent(100, 125)).toBeCloseTo(25, 5);
  });

  it('never divides by zero', () => {
    expect(marginPercent(100, 0)).toBe(0);
    expect(markupPercent(0, 125)).toBe(0);
  });

  it('reports a loss as a negative margin', () => {
    expect(marginPercent(150, 100)).toBeCloseTo(-50, 5);
  });
});

describe('stage ordering', () => {
  it('runs Lead Intake (0) through Actual Performance Feedback (12)', () => {
    expect(STAGE_ORDER.LEAD_INTAKE).toBe(0);
    expect(STAGE_ORDER.ACTUAL_PERFORMANCE_FEEDBACK).toBe(12);
  });

  it('is strictly increasing across the 13 stages', () => {
    const ranks = Object.values(STAGE_ORDER).sort((a, b) => a - b);
    expect(ranks).toEqual([...Array(13).keys()]);
  });
});

describe('progressive data capture', () => {
  it('asks little at intake and more later', () => {
    // Costing must not be left without a cost figure.
    expect(STAGE_EXIT_REQUIREMENTS.COSTING_SOURCING).toContain('estimatedCost');
    // Review must not pass without a price and a margin.
    expect(STAGE_EXIT_REQUIREMENTS.OPERATIONAL_FINANCIAL_REVIEW).toContain('proposedPrice');
    expect(STAGE_EXIT_REQUIREMENTS.OPERATIONAL_FINANCIAL_REVIEW).toContain('marginPercent');
  });
});
