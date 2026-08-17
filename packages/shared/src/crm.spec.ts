import {
  LEAD_STATUSES,
  LEAD_STATUS_TRANSITIONS,
  canTransitionLead,
  isLeadTerminal,
  isRetrospectiveActivity,
  CONTACT_ROLES,
  ACCOUNT_RELATIONSHIP_TYPES,
  INVERSE_ACCOUNT_RELATIONSHIP,
  inverseAccountRelationship,
} from './crm';

describe('lead status transitions', () => {
  it('lets a live lead die at any point', () => {
    expect(canTransitionLead('NEW', 'DISQUALIFIED')).toBe(true);
    expect(canTransitionLead('WORKING', 'DISQUALIFIED')).toBe(true);
    expect(canTransitionLead('QUALIFIED', 'DISQUALIFIED')).toBe(true);
  });

  it('only converts a qualified lead', () => {
    expect(canTransitionLead('QUALIFIED', 'CONVERTED')).toBe(true);
    expect(canTransitionLead('NEW', 'CONVERTED')).toBe(false);
    expect(canTransitionLead('WORKING', 'CONVERTED')).toBe(false);
  });

  it('treats converted and disqualified as terminal', () => {
    expect(isLeadTerminal('CONVERTED')).toBe(true);
    expect(isLeadTerminal('DISQUALIFIED')).toBe(true);
    expect(LEAD_STATUS_TRANSITIONS.CONVERTED).toHaveLength(0);
    expect(LEAD_STATUS_TRANSITIONS.DISQUALIFIED).toHaveLength(0);
  });

  it('never moves a lead backwards', () => {
    expect(canTransitionLead('QUALIFIED', 'NEW')).toBe(false);
    expect(canTransitionLead('WORKING', 'NEW')).toBe(false);
  });

  it('declares a transition list for every status', () => {
    expect(Object.keys(LEAD_STATUS_TRANSITIONS).sort()).toEqual([...LEAD_STATUSES].sort());
  });
});

describe('activity types', () => {
  it('treats a logged call as already done and a task as still open', () => {
    expect(isRetrospectiveActivity('CALL')).toBe(true);
    expect(isRetrospectiveActivity('TASK')).toBe(false);
  });
});

describe('contact roles', () => {
  it('keeps evaluator roles distinct so one person can hold both', () => {
    expect(CONTACT_ROLES).toContain('TECHNICAL_EVALUATOR');
    expect(CONTACT_ROLES).toContain('COMMERCIAL_EVALUATOR');
  });
});

describe('account relationships', () => {
  it('states how every type reads from the other end', () => {
    // The point of the test: adding an eighth type without deciding its
    // inverse must fail here, not draw a subsidiary above its own parent on
    // somebody's group tree six months later.
    expect(Object.keys(INVERSE_ACCOUNT_RELATIONSHIP).sort()).toEqual(
      [...ACCOUNT_RELATIONSHIP_TYPES].sort(),
    );
  });

  it('reads a hierarchy the right way round from each side', () => {
    expect(inverseAccountRelationship('PARENT')).toBe('SUBSIDIARY');
    expect(inverseAccountRelationship('SUBSIDIARY')).toBe('PARENT');
    expect(inverseAccountRelationship('MAIN_CONTRACTOR')).toBe('SUBCONTRACTOR');
    expect(inverseAccountRelationship('SUBCONTRACTOR')).toBe('MAIN_CONTRACTOR');
  });

  it('leaves the symmetric ones alone', () => {
    for (const type of ['JV_PARTNER', 'CONSORTIUM_MEMBER', 'COMPETITOR'] as const) {
      expect(inverseAccountRelationship(type)).toBe(type);
    }
  });

  it('inverts back to itself, so no type is a one-way door', () => {
    for (const type of ACCOUNT_RELATIONSHIP_TYPES) {
      expect(inverseAccountRelationship(inverseAccountRelationship(type))).toBe(type);
    }
  });
});
