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
    // Contract deviations arrive in Release 7; claiming the rule is live
    // before then would be a false assurance in an audit.
    expect(SOD_RULE_BY_CODE.SOD_06.awaitingRelease).toBe(7);
  });

  it('enforces the discount and limit rules now that Release 6 supplies them', () => {
    // SOD_04 is a same-person check: whoever asked for the discount does not
    // grant it. SOD_08 is an authority split instead — the people who may
    // change a limit are a different list from those who approve deals against
    // it, because a per-user check would still let two directors raise each
    // other's ceilings.
    expect(SOD_RULE_BY_CODE.SOD_04.awaitingRelease).toBeNull();
    expect(SOD_RULE_BY_CODE.SOD_08.awaitingRelease).toBeNull();
    expect(sodRulesFor('DiscountRequest').map((r) => r.code)).toContain('SOD_04');
    expect(sodRulesFor('ApprovalPolicy').map((r) => r.code)).toContain('SOD_08');
  });

  it('binds the supplier rule to the commitment that exists today', () => {
    // Release 5 has no purchase order yet, so SOD_03 binds where a partner is
    // actually chosen: selecting the winning quotation. Leaving it pointed at
    // PurchaseOrder would have left the rule declared but unenforced.
    expect(SOD_RULE_BY_CODE.SOD_03.awaitingRelease).toBeNull();
    expect(sodRulesFor('PartnerQuotation').map((r) => r.code)).toContain('SOD_03');
  });

  it('enforces the costing rule now that Release 4 supplies both halves', () => {
    // Whoever builds a costing must not be the one who finally approves it.
    expect(SOD_RULE_BY_CODE.SOD_01.awaitingRelease).toBeNull();
    expect(sodRulesFor('CostingVersion').map((r) => r.code)).toContain('SOD_01');
  });
});
