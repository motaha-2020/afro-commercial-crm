import { SOD_RULES, SOD_RULE_CODES, SOD_RULE_BY_CODE, sodRulesFor } from './sod';

describe('segregation of duties', () => {
  it('carries all eight rules the spec names', () => {
    expect(SOD_RULES).toHaveLength(8);
    expect(SOD_RULES.map((r) => r.code)).toEqual([...SOD_RULE_CODES]);
  });

  it('separates a distinct originating action from the blocked one', () => {
    for (const rule of SOD_RULES) {
      expect(rule.originatingAction).not.toBe(rule.blockedAction);
      expect(rule.titleAr.length).toBeGreaterThan(0);
    }
  });

  it('indexes every rule by code', () => {
    for (const code of SOD_RULE_CODES) {
      expect(SOD_RULE_BY_CODE[code].code).toBe(code);
    }
  });

  it('applies the self-approval rule to every entity type', () => {
    // Rule 7 is the one that survives someone accumulating roles, so it must
    // match entities no module has invented yet.
    expect(sodRulesFor('SomethingFromReleaseTen').map((r) => r.code)).toContain('SOD_07');
  });

  it('checks account credit against the rule the spec assigns it', () => {
    expect(sodRulesFor('Account').map((r) => r.code)).toContain('SOD_05');
  });

  it('does not claim to enforce rules whose module has not shipped', () => {
    // Purchase orders arrive in Release 5; pretending SOD_03 is live before
    // then would be a false assurance in an audit.
    expect(sodRulesFor('PurchaseOrder').map((r) => r.code)).not.toContain('SOD_03');
    expect(SOD_RULE_BY_CODE.SOD_03.awaitingRelease).toBe(5);
  });

  it('enforces the costing rule now that Release 4 supplies both halves', () => {
    // Whoever builds a costing must not be the one who finally approves it.
    expect(SOD_RULE_BY_CODE.SOD_01.awaitingRelease).toBeNull();
    expect(sodRulesFor('CostingVersion').map((r) => r.code)).toContain('SOD_01');
  });
});
