import {
  costConfidence,
  costLineTotal,
  isPricedWithoutCost,
  priceForTargetMargin,
  priceForTargetMarkup,
  rollup,
} from './costing';

describe('cost line total', () => {
  it('multiplies quantity by unit cost', () => {
    expect(costLineTotal({ quantity: 100, unitCost: 12 })).toBe(1200);
  });

  it('buys the waste as well as the work', () => {
    // 5% waste on 100m of cable means paying for 105m.
    expect(costLineTotal({ quantity: 100, unitCost: 10, wastePercent: 5 })).toBe(1050);
  });

  it('converts output into crew-days through the productivity rate', () => {
    // 600m of trenching at 150m/day is four crew-days at 800/day.
    expect(
      costLineTotal({ quantity: 600, unitCost: 800, productivityRate: 150 }),
    ).toBe(3200);
  });

  it('ignores a zero productivity rate instead of dividing by it', () => {
    expect(costLineTotal({ quantity: 10, unitCost: 5, productivityRate: 0 })).toBe(50);
  });

  it('applies the exchange rate before allocation and tax', () => {
    // 1000 EUR at 1.1, half allocated to this item, then 30 of tax.
    expect(
      costLineTotal({
        quantity: 1,
        unitCost: 1000,
        exchangeRate: 1.1,
        allocationPercent: 50,
        taxAmount: 30,
      }),
    ).toBe(580);
  });

  it('returns zero rather than NaN for unusable input', () => {
    expect(costLineTotal({ quantity: Number.NaN, unitCost: 10 })).toBe(0);
  });
});

describe('pricing from a target', () => {
  it('prices for a margin over selling price', () => {
    // 20% margin on cost 100 is a price of 125 — the spec's own example.
    expect(priceForTargetMargin(100, 20)).toBe(125);
  });

  it('prices for a markup over cost', () => {
    expect(priceForTargetMarkup(100, 25)).toBe(125);
  });

  it('keeps the two apart', () => {
    // The whole point: the same 25 produces different prices.
    expect(priceForTargetMargin(100, 25)).not.toBe(priceForTargetMarkup(100, 25));
    expect(priceForTargetMargin(100, 25)).toBeCloseTo(133.33, 1);
  });

  it('refuses a margin of 100% or more instead of returning infinity', () => {
    expect(() => priceForTargetMargin(100, 100)).toThrow(RangeError);
    expect(() => priceForTargetMargin(100, 120)).toThrow(RangeError);
  });
});

describe('rollup', () => {
  const lines = [
    { cost: 1000, price: 1300 },
    { cost: 500, price: 700 },
  ];

  it('totals cost, price and profit', () => {
    const r = rollup(lines);
    expect(r.totalCost).toBe(1500);
    expect(r.totalPrice).toBe(2000);
    expect(r.grossProfit).toBe(500);
  });

  it('reports margin and markup side by side, never one alone', () => {
    const r = rollup(lines);
    expect(r.marginPercent).toBe(25); // 500 / 2000
    expect(r.markupPercent).toBeCloseTo(33.33, 1); // 500 / 1500
  });

  it('survives an empty or costless set', () => {
    expect(rollup([]).marginPercent).toBe(0);
    expect(rollup([{ cost: 0, price: 0 }]).markupPercent).toBe(0);
  });

  it('reports a loss as a negative margin rather than hiding it', () => {
    expect(rollup([{ cost: 150, price: 100 }]).marginPercent).toBe(-50);
  });
});

describe('cost confidence', () => {
  it('is full when every line is a quote', () => {
    const c = costConfidence([
      { cost: 1000, source: 'VENDOR_QUOTE' },
      { cost: 500, source: 'SUBCONTRACTOR_QUOTE' },
    ]);
    expect(c.score).toBe(100);
    expect(c.quotedShare).toBe(100);
  });

  it('weights by money, not by line count', () => {
    // A hundred confident bolts do not redeem one guessed-at civil package.
    const many = Array.from({ length: 100 }, () => ({
      cost: 1,
      source: 'VENDOR_QUOTE' as const,
    }));
    const c = costConfidence([...many, { cost: 900, source: 'MANUAL_ESTIMATE' }]);
    expect(c.estimatedShare).toBe(90);
    expect(c.score).toBeLessThan(40);
  });

  it('breaks the cost down by where each number came from', () => {
    const c = costConfidence([
      { cost: 300, source: 'HISTORICAL_RATE' },
      { cost: 700, source: 'VENDOR_QUOTE' },
    ]);
    expect(c.bySource.HISTORICAL_RATE).toBe(300);
    expect(c.bySource.VENDOR_QUOTE).toBe(700);
    expect(c.score).toBe(91); // 0.7·30 + 1·70
  });

  it('is zero, not NaN, with nothing costed', () => {
    expect(costConfidence([]).score).toBe(0);
  });
});

describe('priced without cost', () => {
  it('flags a price with no costing behind it', () => {
    expect(isPricedWithoutCost(0, 5000)).toBe(true);
  });

  it('does not flag an ordinary costed line', () => {
    expect(isPricedWithoutCost(4000, 5000)).toBe(false);
  });
});
