import {
  APPROVAL_POLICY_KEYS,
  compare,
  evaluateRules,
  isTerminalDecision,
  needsApproval,
  policySnapshot,
  policySpecificity,
  requiredApprovers,
  resolvePolicy,
  type PolicyRow,
  type RuleRow,
} from './approval';

const JAN = new Date('2026-01-01');
const JUN = new Date('2026-06-01');
const NOW = new Date('2026-08-01');

function policy(over: Partial<PolicyRow>): PolicyRow {
  return {
    key: 'MIN_GROSS_MARGIN_PERCENT',
    value: 12,
    effectiveFrom: JAN,
    ...over,
  };
}

describe('resolving which limit applies', () => {
  it('returns nothing when Afro has not set the limit', () => {
    // The important case. A default invented here would be a number nobody
    // agreed to, shown to an approver as if it were policy.
    expect(resolvePolicy([], 'MIN_GROSS_MARGIN_PERCENT', { asOf: NOW })).toBeNull();
  });

  it('uses the group-wide default when nothing narrower is set', () => {
    const rows = [policy({ value: 12 })];
    expect(resolvePolicy(rows, 'MIN_GROSS_MARGIN_PERCENT', { asOf: NOW })?.value).toBe(12);
  });

  it('lets a country override the group default', () => {
    const rows = [policy({ value: 12 }), policy({ value: 18, country: 'EG' })];
    expect(
      resolvePolicy(rows, 'MIN_GROSS_MARGIN_PERCENT', { country: 'EG', asOf: NOW })?.value,
    ).toBe(18);
    expect(
      resolvePolicy(rows, 'MIN_GROSS_MARGIN_PERCENT', { country: 'KE', asOf: NOW })?.value,
    ).toBe(12);
  });

  it('lets one opportunity override everything above it', () => {
    // The manager's freedom Afro asked for: a special limit on one hard deal.
    const rows = [
      policy({ value: 12 }),
      policy({ value: 18, country: 'EG' }),
      policy({ value: 6, opportunityId: 'opp-1' }),
    ];
    expect(
      resolvePolicy(rows, 'MIN_GROSS_MARGIN_PERCENT', {
        country: 'EG',
        opportunityId: 'opp-1',
        asOf: NOW,
      })?.value,
    ).toBe(6);
  });

  it('ranks opportunity above business unit above country', () => {
    expect(policySpecificity({ opportunityId: 'o' })).toBeGreaterThan(
      policySpecificity({ orgUnitId: 'u' }),
    );
    expect(policySpecificity({ orgUnitId: 'u' })).toBeGreaterThan(
      policySpecificity({ country: 'EG' }),
    );
    expect(policySpecificity({})).toBe(0);
  });

  it('does not apply a scoped row outside its scope', () => {
    const rows = [policy({ value: 18, country: 'EG' })];
    expect(resolvePolicy(rows, 'MIN_GROSS_MARGIN_PERCENT', { country: 'KE', asOf: NOW })).toBeNull();
  });

  it('ignores a row that has not taken effect yet', () => {
    const rows = [policy({ value: 12 }), policy({ value: 20, effectiveFrom: new Date('2027-01-01') })];
    expect(resolvePolicy(rows, 'MIN_GROSS_MARGIN_PERCENT', { asOf: NOW })?.value).toBe(12);
  });

  it('ignores a row that has expired', () => {
    const rows = [policy({ value: 20, effectiveFrom: JAN, effectiveTo: JUN })];
    expect(resolvePolicy(rows, 'MIN_GROSS_MARGIN_PERCENT', { asOf: NOW })).toBeNull();
  });

  it('answers as of a past date with the limit that applied then', () => {
    // What makes an old approval still explainable after the policy changes.
    const rows = [
      policy({ value: 20, effectiveFrom: JAN, effectiveTo: JUN }),
      policy({ value: 12, effectiveFrom: JUN }),
    ];
    expect(
      resolvePolicy(rows, 'MIN_GROSS_MARGIN_PERCENT', { asOf: new Date('2026-03-01') })?.value,
    ).toBe(20);
    expect(resolvePolicy(rows, 'MIN_GROSS_MARGIN_PERCENT', { asOf: NOW })?.value).toBe(12);
  });

  it('takes the newer row when two are equally specific', () => {
    const rows = [policy({ value: 12, effectiveFrom: JAN }), policy({ value: 15, effectiveFrom: JUN })];
    expect(resolvePolicy(rows, 'MIN_GROSS_MARGIN_PERCENT', { asOf: NOW })?.value).toBe(15);
  });

  it('snapshots only the keys actually configured', () => {
    const snap = policySnapshot([policy({ value: 12 })], { asOf: NOW });
    expect(snap.MIN_GROSS_MARGIN_PERCENT).toBe(12);
    expect(Object.keys(snap)).toHaveLength(1);
    expect(APPROVAL_POLICY_KEYS.length).toBeGreaterThan(1);
  });
});

describe('comparing a fact against a threshold', () => {
  it('implements each operator as written', () => {
    expect(compare(10, 'LESS_THAN', 12)).toBe(true);
    expect(compare(12, 'LESS_THAN', 12)).toBe(false);
    expect(compare(12, 'LESS_OR_EQUAL', 12)).toBe(true);
    expect(compare(13, 'GREATER_THAN', 12)).toBe(true);
    expect(compare(12, 'GREATER_OR_EQUAL', 12)).toBe(true);
    expect(compare(12, 'EQUALS', 12)).toBe(true);
  });
});

describe('which approvals a deal triggers', () => {
  const marginRule: RuleRow = {
    id: 'r-margin',
    conditionField: 'GROSS_MARGIN_PERCENT',
    operator: 'LESS_THAN',
    thresholdPolicyKey: 'MIN_GROSS_MARGIN_PERCENT',
    requiredRole: 'CEO',
    priority: 10,
  };

  it("fires the spec's own example: margin under the limit needs the CEO", () => {
    const result = evaluateRules([marginRule], { grossMarginPercent: 9 }, [policy({ value: 12 })], {
      asOf: NOW,
    });

    expect(result.fired).toHaveLength(1);
    expect(result.fired[0].requiredRole).toBe('CEO');
    expect(result.fired[0].threshold).toBe(12);
    expect(result.fired[0].actual).toBe(9);
  });

  it('does not fire when the deal is inside the limit', () => {
    const result = evaluateRules([marginRule], { grossMarginPercent: 20 }, [policy({ value: 12 })], {
      asOf: NOW,
    });
    expect(result.fired).toHaveLength(0);
    expect(needsApproval(result)).toBe(false);
  });

  it('follows the country override rather than the group default', () => {
    const policies = [policy({ value: 12 }), policy({ value: 18, country: 'EG' })];
    const inEgypt = evaluateRules([marginRule], { grossMarginPercent: 15 }, policies, {
      country: 'EG',
      asOf: NOW,
    });
    const elsewhere = evaluateRules([marginRule], { grossMarginPercent: 15 }, policies, {
      country: 'KE',
      asOf: NOW,
    });

    // Same deal, same rule, different country — and that is the point.
    expect(inEgypt.fired).toHaveLength(1);
    expect(elsewhere.fired).toHaveLength(0);
  });

  it('reports an unset limit as undetermined instead of as a pass', () => {
    // "The margin is fine" and "nobody said what margin is acceptable" must
    // never look the same to an approver.
    const result = evaluateRules([marginRule], { grossMarginPercent: 3 }, [], { asOf: NOW });

    expect(result.fired).toHaveLength(0);
    expect(result.undetermined).toEqual([
      { ruleId: 'r-margin', reason: 'NO_THRESHOLD_CONFIGURED' },
    ]);
    expect(needsApproval(result)).toBe(true);
  });

  it('reports a missing fact the same way', () => {
    const result = evaluateRules([marginRule], {}, [policy({ value: 12 })], { asOf: NOW });
    expect(result.undetermined).toEqual([{ ruleId: 'r-margin', reason: 'FACT_UNKNOWN' }]);
    expect(needsApproval(result)).toBe(true);
  });

  it('uses a fixed threshold when the rule carries its own', () => {
    const rule: RuleRow = {
      id: 'r-terms',
      conditionField: 'PAYMENT_TERM_DAYS',
      operator: 'GREATER_THAN',
      threshold: 120,
      requiredRole: 'FINANCE_DIRECTOR',
    };
    const result = evaluateRules([rule], { paymentTermDays: 150 }, [], { asOf: NOW });
    expect(result.fired[0].requiredRole).toBe('FINANCE_DIRECTOR');
  });

  it('treats a yes/no condition as the condition itself', () => {
    const rule: RuleRow = {
      id: 'r-country',
      conditionField: 'COUNTRY_IS_NEW',
      operator: 'IS_TRUE',
      requiredRole: 'LEGAL',
    };
    expect(evaluateRules([rule], { countryIsNew: true }, [], { asOf: NOW }).fired).toHaveLength(1);
    expect(evaluateRules([rule], { countryIsNew: false }, [], { asOf: NOW }).fired).toHaveLength(0);
  });

  it('skips a deactivated rule without reporting it as unjudged', () => {
    const result = evaluateRules(
      [{ ...marginRule, isActive: false }],
      { grossMarginPercent: 1 },
      [policy({ value: 12 })],
      { asOf: NOW },
    );
    expect(result.fired).toHaveLength(0);
    expect(result.undetermined).toHaveLength(0);
  });

  it('leads with the highest-priority reason', () => {
    const rules: RuleRow[] = [
      { ...marginRule, id: 'low', priority: 1, requiredRole: 'SALES_DIRECTOR' },
      { ...marginRule, id: 'high', priority: 99, requiredRole: 'CEO' },
    ];
    const result = evaluateRules(rules, { grossMarginPercent: 5 }, [policy({ value: 12 })], {
      asOf: NOW,
    });
    expect(result.fired.map((f) => f.ruleId)).toEqual(['high', 'low']);
  });

  it('collects each approver once even when several rules name them', () => {
    const rules: RuleRow[] = [
      { ...marginRule, id: 'a' },
      { ...marginRule, id: 'b' },
    ];
    const result = evaluateRules(rules, { grossMarginPercent: 5 }, [policy({ value: 12 })], {
      asOf: NOW,
    });
    expect(result.fired).toHaveLength(2);
    expect(requiredApprovers(result)).toEqual(['CEO']);
  });
});

describe('what a decision does to the request', () => {
  it('return for revision keeps the deal alive', () => {
    // Otherwise it would just be a rejection with a kinder word.
    expect(isTerminalDecision('RETURN_FOR_REVISION')).toBe(false);
  });

  it('the other three close it', () => {
    expect(isTerminalDecision('APPROVE')).toBe(true);
    expect(isTerminalDecision('REJECT')).toBe(true);
    expect(isTerminalDecision('APPROVE_WITH_CONDITIONS')).toBe(true);
  });
});
