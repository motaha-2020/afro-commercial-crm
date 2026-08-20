import {
  applicableRules,
  computeIndirectCosts,
  fullCostTotals,
  ruleSpecificity,
  type CostRule,
} from './cost-rules';

const NOW = new Date('2026-08-01');

function rule(over: Partial<CostRule> = {}): CostRule {
  return {
    id: 'r1',
    name: 'Group G&A',
    category: 'G_AND_A',
    method: 'PERCENT_OF_DIRECT_COST',
    value: 10,
    effectiveFrom: new Date('2026-01-01'),
    approvalStatus: 'APPROVED',
    ...over,
  };
}

const base = { directCost: 100_000, sellingPrice: 125_000 };

describe('a rule Finance has not approved never touches a number', () => {
  it('ignores a draft rule entirely', () => {
    // A draft is somebody's proposal. Applying proposals to real bids is how a
    // company discovers its overhead policy after the fact.
    const result = computeIndirectCosts([rule({ approvalStatus: 'DRAFT' })], base, { asOf: NOW });

    expect(result.applied).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('ignores a rejected one too', () => {
    expect(
      computeIndirectCosts([rule({ approvalStatus: 'REJECTED' })], base, { asOf: NOW }).total,
    ).toBe(0);
  });

  it('applies an approved one', () => {
    expect(computeIndirectCosts([rule()], base, { asOf: NOW }).total).toBe(10_000);
  });
});

describe('the calculation methods', () => {
  it('takes a percentage of direct cost', () => {
    const r = computeIndirectCosts([rule({ value: 12 })], base, { asOf: NOW });
    expect(r.applied[0].amount).toBe(12_000);
    expect(r.applied[0].basis).toBe(100_000);
  });

  it('takes a percentage of revenue against the price as it stands', () => {
    // Never iterated: raising cost would raise price would raise the rule.
    const r = computeIndirectCosts(
      [rule({ method: 'PERCENT_OF_REVENUE', value: 4 })],
      base,
      { asOf: NOW },
    );

    expect(r.applied[0].amount).toBe(5_000);
    expect(r.applied[0].basis).toBe(125_000);
  });

  it('adds a fixed amount regardless of size', () => {
    const r = computeIndirectCosts(
      [rule({ method: 'FIXED_AMOUNT', value: 7_500 })],
      base,
      { asOf: NOW },
    );
    expect(r.applied[0].amount).toBe(7_500);
  });

  it('multiplies a monthly rate by the duration', () => {
    const r = computeIndirectCosts(
      [rule({ method: 'MONTHLY_RATE', value: 2_000 })],
      { ...base, durationMonths: 6 },
      { asOf: NOW },
    );
    expect(r.applied[0].amount).toBe(12_000);
  });

  it('reports a monthly rule with no duration instead of treating it as zero', () => {
    // Unknown is not nothing, and pretending otherwise understates the bid.
    const r = computeIndirectCosts(
      [rule({ method: 'MONTHLY_RATE', value: 2_000 })],
      base,
      { asOf: NOW },
    );

    expect(r.total).toBe(0);
    expect(r.skipped).toEqual([{ ruleId: 'r1', name: 'Group G&A', reason: 'NO_DURATION' }]);
  });

  it('reports a revenue rule with no price the same way', () => {
    const r = computeIndirectCosts(
      [rule({ method: 'PERCENT_OF_REVENUE', value: 4 })],
      { directCost: 100_000, sellingPrice: 0 },
      { asOf: NOW },
    );

    expect(r.skipped[0].reason).toBe('NO_SELLING_PRICE');
  });
});

describe('order must not change the total', () => {
  it('gives the same answer whichever way the rules are listed', () => {
    // The trap: if a percentage took "cost so far" as its base, 10% then 5%
    // would not equal 5% then 10%.
    const gna = rule({ id: 'a', category: 'G_AND_A', value: 10 });
    const overhead = rule({ id: 'b', category: 'OVERHEAD', name: 'Overhead', value: 5 });

    const oneWay = computeIndirectCosts([gna, overhead], base, { asOf: NOW }).total;
    const other = computeIndirectCosts([overhead, gna], base, { asOf: NOW }).total;

    expect(oneWay).toBe(other);
    expect(oneWay).toBe(15_000);
  });

  it('never lets one rule compute off another rule output', () => {
    const gna = rule({ id: 'a', category: 'G_AND_A', value: 10 });
    const overhead = rule({ id: 'b', category: 'OVERHEAD', name: 'Overhead', value: 10 });

    const result = computeIndirectCosts([gna, overhead], base, { asOf: NOW });

    // 10,000 + 10,000, not 10,000 + 11,000.
    expect(result.applied.every((a) => a.basis === 100_000)).toBe(true);
  });
});

describe('scope', () => {
  it('ranks a business unit above a country above the group', () => {
    expect(ruleSpecificity({ orgUnitId: 'u' })).toBeGreaterThan(ruleSpecificity({ country: 'EG' }));
    expect(ruleSpecificity({ country: 'EG' })).toBeGreaterThan(ruleSpecificity({}));
    // One bid outranks every combination of wider scopes. A rule written for
    // a single tender that a country rule could overrule would be pointless.
    expect(ruleSpecificity({ opportunityId: 'o' })).toBeGreaterThan(
      ruleSpecificity({ orgUnitId: 'u', country: 'EG' }),
    );
  });

  it('replaces the group default rather than stacking on it', () => {
    // The reason the release was deferred: one rate on everything makes a
    // cheap country subsidise an expensive one.
    const rules = [rule({ id: 'group', value: 10 }), rule({ id: 'eg', value: 18, country: 'EG' })];

    const inEgypt = computeIndirectCosts(rules, base, { country: 'EG', asOf: NOW });
    const elsewhere = computeIndirectCosts(rules, base, { country: 'KE', asOf: NOW });

    expect(inEgypt.total).toBe(18_000);
    expect(elsewhere.total).toBe(10_000);
    expect(inEgypt.applied).toHaveLength(1);
  });

  it('accumulates across categories, because they are different costs', () => {
    const rules = [
      rule({ id: 'a', category: 'G_AND_A', value: 10 }),
      rule({ id: 'b', category: 'FINANCING', name: 'Financing', value: 3 }),
      rule({ id: 'c', category: 'RISK_PROVISION', name: 'Risk', value: 2 }),
    ];

    const result = computeIndirectCosts(rules, base, { asOf: NOW });

    expect(result.total).toBe(15_000);
    expect(result.byCategory.G_AND_A).toBe(10_000);
    expect(result.byCategory.FINANCING).toBe(3_000);
    expect(result.byCategory.RISK_PROVISION).toBe(2_000);
    expect(result.byCategory.INSURANCE).toBe(0);
  });

  it('ignores a rule that has expired', () => {
    const expired = rule({ effectiveTo: new Date('2026-06-01') });
    expect(applicableRules([expired], { asOf: NOW })).toEqual([]);
  });

  it('ignores one that has not started', () => {
    const future = rule({ effectiveFrom: new Date('2027-01-01') });
    expect(applicableRules([future], { asOf: NOW })).toEqual([]);
  });

  it('takes the newer of two equally specific rules', () => {
    const rules = [
      rule({ id: 'old', value: 10, effectiveFrom: new Date('2026-01-01') }),
      rule({ id: 'new', value: 14, effectiveFrom: new Date('2026-07-01') }),
    ];
    expect(applicableRules(rules, { asOf: NOW })[0].id).toBe('new');
  });
});

describe('the summary the costing screen shows', () => {
  it('splits direct from indirect and keeps margin over price', () => {
    const totals = fullCostTotals(
      [
        rule({ id: 'a', category: 'G_AND_A', value: 10 }),
        rule({ id: 'b', category: 'FINANCING', name: 'Financing', value: 5 }),
      ],
      base,
      { asOf: NOW },
    );

    expect(totals.directCost).toBe(100_000);
    expect(totals.indirectCost).toBe(15_000);
    expect(totals.totalCost).toBe(115_000);
    // 125,000 − 115,000 = 10,000 over a price of 125,000.
    expect(totals.grossProfit).toBe(10_000);
    expect(totals.marginPercent).toBe(8);
  });

  it('shows a margin turning negative once overheads are counted', () => {
    // The whole point of the engine: a bid that looked profitable on direct
    // cost alone.
    const totals = fullCostTotals(
      [rule({ value: 30 })],
      { directCost: 100_000, sellingPrice: 125_000 },
      { asOf: NOW },
    );

    expect(totals.totalCost).toBe(130_000);
    expect(totals.grossProfit).toBe(-5_000);
    expect(totals.marginPercent).toBeLessThan(0);
  });

  it('is unchanged when no rule has been approved', () => {
    const totals = fullCostTotals([rule({ approvalStatus: 'DRAFT' })], base, { asOf: NOW });

    expect(totals.totalCost).toBe(100_000);
    expect(totals.marginPercent).toBe(20);
  });
});

describe('a rule written for one opportunity', () => {
  const groupRule = rule({ id: 'group', value: 10 });
  const countryRule = rule({ id: 'country', value: 9, country: 'EG' });
  const bidRule = rule({ id: 'bid', value: 4, opportunityId: 'opp-1' });

  it('replaces the wider rules when costing that opportunity', () => {
    const applied = applicableRules([groupRule, countryRule, bidRule], {
      asOf: NOW,
      country: 'EG',
      opportunityId: 'opp-1',
    });

    // Replaces, not stacks: one G&A percentage applies to a bid, and adding
    // 4% on top of 9% is a different number nobody approved.
    expect(applied).toHaveLength(1);
    expect(applied[0].id).toBe('bid');
  });

  it('never leaks onto a different opportunity', () => {
    const applied = applicableRules([groupRule, bidRule], {
      asOf: NOW,
      opportunityId: 'opp-2',
    });

    expect(applied.map((r) => r.id)).toEqual(['group']);
  });

  it('does not apply when nothing in particular is being costed', () => {
    const applied = applicableRules([groupRule, bidRule], { asOf: NOW });

    expect(applied.map((r) => r.id)).toEqual(['group']);
  });

  it('is still ignored while it is only a draft', () => {
    // The narrowest scope does not buy a way around Finance's approval.
    const applied = applicableRules(
      [groupRule, rule({ id: 'bid', value: 4, opportunityId: 'opp-1', approvalStatus: 'DRAFT' })],
      { asOf: NOW, opportunityId: 'opp-1' },
    );

    expect(applied.map((r) => r.id)).toEqual(['group']);
  });

  it('changes the money the bid carries', () => {
    const withoutBidRule = computeIndirectCosts([groupRule], base, { asOf: NOW });
    const withBidRule = computeIndirectCosts([groupRule, bidRule], base, {
      asOf: NOW,
      opportunityId: 'opp-1',
    });

    expect(withoutBidRule.total).toBe(10_000);
    expect(withBidRule.total).toBe(4_000);
  });
});
