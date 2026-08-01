import {
  AWARD_STRENGTH,
  AWARD_TYPES,
  REQUIRED_HANDOVER_PARTIES,
  detectDeviations,
  handoverReadiness,
  hasBlockingDeviation,
  isBinding,
  signoffProgress,
  strongerAward,
  type ComparableTerms,
} from './contract';

describe('a verbal award is not a signed contract', () => {
  it('ranks every award type without ties', () => {
    const values = AWARD_TYPES.map((t) => AWARD_STRENGTH[t]);
    expect(new Set(values).size).toBe(AWARD_TYPES.length);
  });

  it('treats a phone call as the weakest thing there is', () => {
    expect(isBinding('VERBAL_AWARD')).toBe(false);
    expect(isBinding('LETTER_OF_INTENT')).toBe(false);
  });

  it('treats a purchase order and everything above it as binding', () => {
    expect(isBinding('PURCHASE_ORDER')).toBe(true);
    expect(isBinding('CONTRACT_RECEIVED')).toBe(true);
    expect(isBinding('CONTRACT_SIGNED')).toBe(true);
    expect(isBinding('NOTICE_TO_PROCEED')).toBe(true);
  });

  it('never lets a weaker award replace a stronger one', () => {
    // A customer who phones after sending the PO has not un-ordered the work.
    expect(strongerAward('CONTRACT_SIGNED', 'VERBAL_AWARD')).toBe('CONTRACT_SIGNED');
    expect(strongerAward('VERBAL_AWARD', 'CONTRACT_SIGNED')).toBe('CONTRACT_SIGNED');
  });
});

describe('what the contract changed', () => {
  const proposal: ComparableTerms = {
    price: 1_000_000,
    paymentTerms: '30 days net',
    durationDays: 180,
    warrantyMonths: 12,
    ldPercent: 5,
    liabilityCap: 500_000,
  };

  it('finds nothing when the contract matches the offer', () => {
    expect(detectDeviations(proposal, { ...proposal })).toEqual([]);
  });

  it('ignores a rounding difference in price', () => {
    expect(detectDeviations(proposal, { ...proposal, price: 1_000_000.005 })).toEqual([]);
  });

  it('grades a price cut by how deep it is', () => {
    const bandFor = (price: number) => detectDeviations(proposal, { ...proposal, price })[0].riskLevel;

    expect(bandFor(990_000)).toBe('MEDIUM'); // 1%
    expect(bandFor(970_000)).toBe('HIGH'); // 3%
    expect(bandFor(900_000)).toBe('CRITICAL'); // 10%
  });

  it('reports a price INCREASE too, because it usually means the wrong document', () => {
    // Finding this out from the customer later is worse than finding it now.
    const found = detectDeviations(proposal, { ...proposal, price: 1_100_000 });

    expect(found).toHaveLength(1);
    expect(found[0].direction).toBe('BETTER');
  });

  it('treats a shorter delivery period as the dangerous direction', () => {
    // The same work in less time is a cost increase nobody has costed.
    const shorter = detectDeviations(proposal, { ...proposal, durationDays: 120 });
    const longer = detectDeviations(proposal, { ...proposal, durationDays: 240 });

    expect(shorter[0].riskLevel).toBe('HIGH');
    expect(shorter[0].direction).toBe('WORSE');
    expect(longer[0].direction).toBe('BETTER');
  });

  it('treats a longer warranty as worse for us, not better', () => {
    const found = detectDeviations(proposal, { ...proposal, warrantyMonths: 24 });

    expect(found[0].field).toBe('WARRANTY');
    expect(found[0].direction).toBe('WORSE');
  });

  it('calls a penalty that was never offered critical', () => {
    const found = detectDeviations({ ...proposal, ldPercent: null }, { ...proposal, ldPercent: 10 });

    expect(found[0].field).toBe('PENALTIES');
    expect(found[0].riskLevel).toBe('CRITICAL');
  });

  it('calls a removed liability cap critical — that is unlimited liability', () => {
    const found = detectDeviations(proposal, { ...proposal, liabilityCap: null });

    expect(found[0].field).toBe('LIABILITIES');
    expect(found[0].riskLevel).toBe('CRITICAL');
    expect(found[0].direction).toBe('WORSE');
  });

  it('leads with the most dangerous change', () => {
    const found = detectDeviations(proposal, {
      ...proposal,
      warrantyMonths: 13,
      liabilityCap: null,
    });

    expect(found[0].riskLevel).toBe('CRITICAL');
    expect(hasBlockingDeviation(found)).toBe(true);
  });

  it('says nothing about a term neither side stated', () => {
    expect(detectDeviations({ price: 100 }, { price: 100 })).toEqual([]);
  });
});

describe('the gate before an opportunity becomes a project', () => {
  const ready = {
    awardType: 'CONTRACT_SIGNED' as const,
    contractReviewedAt: new Date('2026-07-01'),
    contractValue: 1_000_000,
    scopeReady: true,
    costBaselineApproved: true,
    projectManagerId: 'user-9',
    plannedStartDate: new Date('2026-09-01'),
    openCriticalDeviations: 0,
  };

  it('passes when every condition the spec lists is met', () => {
    const result = handoverReadiness(ready);

    expect(result.ready).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it('refuses to hand over a project won by phone call', () => {
    const result = handoverReadiness({ ...ready, awardType: 'VERBAL_AWARD' });

    expect(result.ready).toBe(false);
    expect(result.missing).toContain('BINDING_AWARD');
  });

  it('names what is missing rather than counting it', () => {
    // "5 of 8 complete" hides which three, and the three always matter.
    const result = handoverReadiness({
      ...ready,
      costBaselineApproved: false,
      projectManagerId: null,
      plannedStartDate: null,
    });

    expect(result.missing).toEqual([
      'COST_BASELINE_APPROVED',
      'PROJECT_MANAGER_NAMED',
      'START_DATE_SET',
    ]);
  });

  it('blocks on an unresolved critical deviation', () => {
    const result = handoverReadiness({ ...ready, openCriticalDeviations: 1 });

    expect(result.missing).toEqual(['DEVIATIONS_RESOLVED']);
  });

  it('treats an unreviewed contract as not ready however complete the rest', () => {
    const result = handoverReadiness({ ...ready, contractReviewedAt: null });

    expect(result.ready).toBe(false);
  });

  it('is not satisfied by an empty input', () => {
    const result = handoverReadiness({});

    expect(result.ready).toBe(false);
    expect(result.met).toEqual(['DEVIATIONS_RESOLVED']);
  });
});

describe('who has to accept the handover', () => {
  it('does not require legal by default — the spec says "عند الحاجة"', () => {
    expect(REQUIRED_HANDOVER_PARTIES).not.toContain('LEGAL');
    expect(REQUIRED_HANDOVER_PARTIES).toContain('PROJECT_MANAGER');
  });

  it('is incomplete while anyone has not answered', () => {
    const progress = signoffProgress([
      { party: 'SALES', isAccepted: true },
      { party: 'COMMERCIAL', isAccepted: true },
    ]);

    expect(progress.complete).toBe(false);
    expect(progress.awaiting).toContain('PROJECT_MANAGER');
  });

  it('is complete only when every required party has accepted', () => {
    const progress = signoffProgress(
      REQUIRED_HANDOVER_PARTIES.map((party) => ({ party, isAccepted: true })),
    );

    expect(progress.complete).toBe(true);
    expect(progress.rejected).toEqual([]);
  });

  it('one refusal stops it, even against five acceptances', () => {
    // A project manager saying "I cannot deliver this" is the most valuable
    // signal in the release; it must not be outvoted.
    const progress = signoffProgress(
      REQUIRED_HANDOVER_PARTIES.map((party) => ({
        party,
        isAccepted: party !== 'PROJECT_MANAGER',
      })),
    );

    expect(progress.complete).toBe(false);
    expect(progress.rejected).toEqual(['PROJECT_MANAGER']);
  });

  it('ignores a party nobody asked for', () => {
    const progress = signoffProgress([
      ...REQUIRED_HANDOVER_PARTIES.map((party) => ({ party, isAccepted: true })),
      { party: 'LEGAL' as const, isAccepted: false },
    ]);

    expect(progress.complete).toBe(true);
  });
});
