import {
  attainmentBand,
  isMoneyMetric,
  periodElapsedPercent,
  periodWindow,
  progressFor,
  type SalesTarget,
  type TargetOpportunity,
} from './targets';

const target = (over: Partial<SalesTarget> = {}): SalesTarget => ({
  id: 't1',
  userId: 'user-1',
  period: 'QUARTER',
  periodStart: new Date('2026-07-01T00:00:00Z'),
  metric: 'WON_VALUE',
  currency: 'USD',
  value: 1_000_000,
  ...over,
});

const opp = (over: Partial<TargetOpportunity> = {}): TargetOpportunity => ({
  ownerId: 'user-1',
  orgUnitId: 'unit-1',
  status: 'CLOSED',
  currency: 'USD',
  estimatedValue: 250_000,
  closedAt: new Date('2026-08-01T00:00:00Z'),
  ...over,
});

describe('periodWindow', () => {
  it('is half-open, so one deal cannot fill two quarters', () => {
    const q3 = periodWindow('QUARTER', new Date('2026-07-01T00:00:00Z'));
    const q4 = periodWindow('QUARTER', new Date('2026-10-01T00:00:00Z'));

    expect(q3.to.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    // Q3 ends exactly where Q4 begins, and the boundary belongs to Q4.
    expect(q4.from.getTime()).toBe(q3.to.getTime());
  });

  it('covers a month and a year too', () => {
    expect(periodWindow('MONTH', new Date('2026-12-01T00:00:00Z')).to.toISOString()).toBe(
      '2027-01-01T00:00:00.000Z',
    );
    expect(periodWindow('YEAR', new Date('2026-01-01T00:00:00Z')).to.toISOString()).toBe(
      '2027-01-01T00:00:00.000Z',
    );
  });
});

describe('progressFor', () => {
  it('counts only deals that closed inside the window', () => {
    const result = progressFor(target(), [
      opp({ estimatedValue: 400_000, closedAt: new Date('2026-08-15T00:00:00Z') }),
      // Closed the day the next quarter starts — belongs to that one.
      opp({ estimatedValue: 999_000, closedAt: new Date('2026-10-01T00:00:00Z') }),
      // Closed before the quarter opened.
      opp({ estimatedValue: 999_000, closedAt: new Date('2026-06-30T00:00:00Z') }),
    ]);

    expect(result.actual).toBe(400_000);
    expect(result.attainmentPercent).toBe(40);
    expect(result.basis).toBe(1);
  });

  it('counts only the target owner’s deals', () => {
    const result = progressFor(target(), [
      opp({ estimatedValue: 300_000 }),
      opp({ ownerId: 'someone-else', estimatedValue: 700_000 }),
    ]);

    expect(result.actual).toBe(300_000);
  });

  it('measures a unit target against the unit, not a person', () => {
    const result = progressFor(target({ userId: null, orgUnitId: 'unit-1' }), [
      opp({ ownerId: 'a', estimatedValue: 300_000 }),
      opp({ ownerId: 'b', estimatedValue: 200_000 }),
      opp({ ownerId: 'c', orgUnitId: 'unit-2', estimatedValue: 900_000 }),
    ]);

    expect(result.actual).toBe(500_000);
    expect(result.basis).toBe(2);
  });

  it('ignores deals in another currency rather than converting them', () => {
    const result = progressFor(target(), [
      opp({ estimatedValue: 300_000 }),
      opp({ currency: 'EGP', estimatedValue: 20_000_000 }),
    ]);

    // Converting would invent a rate; summing would produce an amount that is
    // money in no currency.
    expect(result.actual).toBe(300_000);
  });

  it('is unmeasurable, not zero, when no deal is in the target’s currency', () => {
    const result = progressFor(target({ currency: 'GBP' }), [opp({ estimatedValue: 300_000 })]);

    // 0% would read as failure. The truth is that this target does not
    // describe this book.
    expect(result.actual).toBeNull();
    expect(result.attainmentPercent).toBeNull();
    expect(result.unmeasurableReason).toBe('NO_MATCHING_CURRENCY');
  });

  it('counts deals rather than money for a count target, and needs no currency', () => {
    const result = progressFor(target({ metric: 'WON_COUNT', currency: null, value: 4 }), [
      opp({ estimatedValue: 10 }),
      opp({ currency: 'EGP', estimatedValue: 999 }),
      opp({ status: 'ACTIVE', closedAt: null }),
    ]);

    // Both closed deals count, whatever currency they are in; the open one
    // does not.
    expect(result.actual).toBe(2);
    expect(result.attainmentPercent).toBe(50);
  });

  it('reads pipeline as a standing balance, not as something accumulated', () => {
    const result = progressFor(target({ metric: 'PIPELINE_VALUE', value: 2_000_000 }), [
      opp({ status: 'ACTIVE', closedAt: null, estimatedValue: 800_000 }),
      opp({ status: 'ON_HOLD', closedAt: null, estimatedValue: 200_000 }),
      // Already closed, so it is no longer pipeline.
      opp({ estimatedValue: 500_000 }),
    ]);

    expect(result.actual).toBe(1_000_000);
    expect(result.attainmentPercent).toBe(50);
  });

  it('refuses to compute attainment against a target of zero', () => {
    const result = progressFor(target({ value: 0 }), [opp({ estimatedValue: 300_000 })]);

    // Not infinite, not 100% — a target nobody can be measured against.
    expect(result.attainmentPercent).toBeNull();
    expect(result.unmeasurableReason).toBe('TARGET_IS_ZERO');
    expect(result.actual).toBe(300_000);
  });

  it('treats a missing estimate as nothing rather than skipping the deal', () => {
    const result = progressFor(target({ metric: 'WON_COUNT', currency: null, value: 2 }), [
      opp({ estimatedValue: null }),
    ]);

    expect(result.actual).toBe(1);
  });
});

describe('reading an attainment', () => {
  it('bands it without pretending to know the calendar', () => {
    expect(attainmentBand(120)).toBe('ahead');
    expect(attainmentBand(100)).toBe('ahead');
    expect(attainmentBand(90)).toBe('on_track');
    expect(attainmentBand(70)).toBe('behind');
    expect(attainmentBand(10)).toBe('at_risk');
  });

  it('says how far through the period we are, which is what makes it mean anything', () => {
    const start = new Date('2026-01-01T00:00:00Z');

    // 40% of a target is ahead in March and a crisis in December.
    expect(periodElapsedPercent('YEAR', start, new Date('2026-01-01T00:00:00Z'))).toBe(0);
    expect(periodElapsedPercent('YEAR', start, new Date('2026-12-31T00:00:00Z'))).toBeGreaterThan(99);
    expect(periodElapsedPercent('YEAR', start, new Date('2027-06-01T00:00:00Z'))).toBe(100);
  });

  it('knows which metrics need a currency', () => {
    expect(isMoneyMetric('WON_VALUE')).toBe(true);
    expect(isMoneyMetric('PIPELINE_VALUE')).toBe(true);
    expect(isMoneyMetric('WON_COUNT')).toBe(false);
  });
});
