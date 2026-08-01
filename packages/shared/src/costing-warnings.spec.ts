import {
  NOT_YET_COMPUTABLE,
  WEAK_SOURCE_SHARE_LIMIT,
  hasBlockingWarning,
  warningsForItem,
  warningsForVersion,
  type WarnBoqItem,
} from './costing-warnings';

const NOW = new Date('2026-08-01');

function item(over: Partial<WarnBoqItem> = {}): WarnBoqItem {
  return {
    id: 'boq-1',
    quantity: 100,
    internalCost: 1000,
    sellingTotal: 1250,
    breakdown: [
      { id: 'b1', source: 'VENDOR_QUOTE', totalCost: 1000, elementId: 'el-1' },
    ],
    ...over,
  };
}

const codes = (i: WarnBoqItem) => warningsForItem(i, NOW).map((w) => w.code);

describe('a healthy item raises nothing', () => {
  it('says nothing when the numbers are sound', () => {
    expect(warningsForItem(item(), NOW)).toEqual([]);
  });
});

describe('the warnings that should stop a bid', () => {
  it('flags an item that costs money and is priced at nothing', () => {
    const found = warningsForItem(item({ sellingTotal: null }), NOW);

    expect(found[0].code).toBe('NO_SELLING_PRICE');
    expect(found[0].severity).toBe('BLOCKING');
  });

  it('flags a price below the cost', () => {
    const found = warningsForItem(item({ sellingTotal: 900 }), NOW);

    expect(found.map((w) => w.code)).toContain('NEGATIVE_MARGIN');
    expect(hasBlockingWarning(warningsForVersion([item({ sellingTotal: 900 })], NOW))).toBe(true);
  });

  it('does not call a free item under water when it costs nothing either', () => {
    // A provisional line with no cost and no price yet is not a loss.
    expect(codes(item({ internalCost: 0, sellingTotal: null, breakdown: [] }))).not.toContain(
      'NO_SELLING_PRICE',
    );
  });
});

describe('the warnings that mean somebody should look', () => {
  it('flags a quantity of zero, which silently zeroes the line', () => {
    expect(codes(item({ quantity: 0 }))).toContain('ZERO_OR_MISSING_QUANTITY');
    expect(codes(item({ quantity: null }))).toContain('ZERO_OR_MISSING_QUANTITY');
  });

  it('flags an item with no cost lines at all', () => {
    expect(codes(item({ breakdown: [], internalCost: 0, sellingTotal: 100 }))).toContain(
      'NO_COST_LINES',
    );
  });

  it('flags a vendor quote that has lapsed', () => {
    // The number is still in the bid; the supplier is no longer held to it.
    const found = codes(
      item({
        breakdown: [
          {
            id: 'b1',
            source: 'VENDOR_QUOTE',
            totalCost: 1000,
            quotationValidUntil: new Date('2026-01-01'),
          },
        ],
      }),
    );

    expect(found).toContain('EXPIRED_VENDOR_QUOTE');
  });

  it('says nothing about a quote still in date', () => {
    expect(
      codes(
        item({
          breakdown: [
            {
              id: 'b1',
              source: 'VENDOR_QUOTE',
              totalCost: 1000,
              quotationValidUntil: new Date('2027-01-01'),
            },
          ],
        }),
      ),
    ).not.toContain('EXPIRED_VENDOR_QUOTE');
  });
});

describe('cost resting on opinion rather than commitment', () => {
  it('stays quiet when a small part of the cost is estimated', () => {
    // Flagging every estimate trains people to ignore the colour.
    const found = codes(
      item({
        breakdown: [
          { id: 'b1', source: 'VENDOR_QUOTE', totalCost: 900 },
          { id: 'b2', source: 'MANUAL_ESTIMATE', totalCost: 100 },
        ],
      }),
    );

    expect(found).not.toContain('WEAK_COST_SOURCE');
  });

  it('speaks when most of the number is a guess', () => {
    const found = warningsForItem(
      item({
        breakdown: [
          { id: 'b1', source: 'VENDOR_QUOTE', totalCost: 100 },
          { id: 'b2', source: 'MANUAL_ESTIMATE', totalCost: 900 },
        ],
      }),
      NOW,
    );

    const weak = found.find((w) => w.code === 'WEAK_COST_SOURCE');
    expect(weak?.severity).toBe('INFO');
    expect(weak?.detail).toBe('90%');
  });

  it('has a threshold that is neither zero nor everything', () => {
    expect(WEAK_SOURCE_SHARE_LIMIT).toBeGreaterThan(0);
    expect(WEAK_SOURCE_SHARE_LIMIT).toBeLessThan(1);
  });

  it('treats an internal rate as evidence, not opinion', () => {
    // Our own crew rate is a real cost we control, not a guess about someone
    // else's price.
    expect(
      codes(item({ breakdown: [{ id: 'b1', source: 'INTERNAL_RATE', totalCost: 1000 }] })),
    ).not.toContain('WEAK_COST_SOURCE');
  });
});

describe('the same cost element twice', () => {
  it('flags a duplicate, because it double counts plausibly', () => {
    const found = warningsForItem(
      item({
        internalCost: 2000,
        sellingTotal: 3000,
        breakdown: [
          { id: 'b1', source: 'VENDOR_QUOTE', totalCost: 1000, elementId: 'el-1' },
          { id: 'b2', source: 'VENDOR_QUOTE', totalCost: 1000, elementId: 'el-1' },
        ],
      }),
      NOW,
    );

    const dup = found.find((w) => w.code === 'DUPLICATE_COST_ELEMENT');
    expect(dup?.detail).toBe('el-1');
  });

  it('says nothing about lines with no element attached', () => {
    expect(
      codes(
        item({
          breakdown: [
            { id: 'b1', source: 'VENDOR_QUOTE', totalCost: 500 },
            { id: 'b2', source: 'VENDOR_QUOTE', totalCost: 500 },
          ],
        }),
      ),
    ).not.toContain('DUPLICATE_COST_ELEMENT');
  });
});

describe('the version-level summary', () => {
  it('counts by severity and indexes by item', () => {
    const summary = warningsForVersion(
      [item({ id: 'a', sellingTotal: null }), item({ id: 'b', quantity: 0 }), item({ id: 'c' })],
      NOW,
    );

    expect(summary.blocking).toBe(1);
    expect(summary.high).toBe(1);
    expect(Object.keys(summary.byItem).sort()).toEqual(['a', 'b']);
    expect(summary.byItem.c).toBeUndefined();
  });

  it('only a blocking warning stops a submission', () => {
    // An approver's attention is finite; spending it on an estimate share is
    // how people learn to click through.
    const informational = warningsForVersion([item({ quantity: 0 })], NOW);
    expect(hasBlockingWarning(informational)).toBe(false);
  });
});

describe('what this deliberately does not check', () => {
  it('names the checks it cannot honestly make', () => {
    // A warning that never fires is worse than none: its silence reads as
    // assurance.
    const codes = NOT_YET_COMPUTABLE.map((n) => n.code);
    expect(codes).toContain('BELOW_HISTORICAL_AVERAGE');
    expect(codes).toContain('STALE_EXCHANGE_RATE');
  });
});
