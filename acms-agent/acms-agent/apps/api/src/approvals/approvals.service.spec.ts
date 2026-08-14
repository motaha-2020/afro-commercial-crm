import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PoliciesService } from './policies.service';
import { DiscountsService } from './discounts.service';
import { ProposalsService } from './proposals.service';
import type { AuthenticatedUser } from '../auth/auth.types';

function userWith(roles: string[], id = 'user-1'): AuthenticatedUser {
  return {
    id,
    email: `${id}@afro.example`,
    orgUnitId: 'org-1',
    roles: roles.map((role) => ({ role, scope: 'GROUP' })),
  } as AuthenticatedUser;
}

const ceo = userWith(['CEO'], 'ceo');
const salesDirector = userWith(['SALES_DIRECTOR'], 'sd');

// ---------------------------------------------------------------------------
// SOD_08 — who may move a limit
// ---------------------------------------------------------------------------

function policiesService(rows: unknown[] = []) {
  const prisma = {
    approvalPolicy: {
      findMany: jest.fn().mockResolvedValue(rows),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }) => ({ id: 'pol-1', ...data })),
      update: jest.fn(),
    },
    $transaction: jest.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(prisma),
    ),
  };
  const audit = { record: jest.fn(), recordUpdate: jest.fn() };
  return { service: new PoliciesService(prisma as never, audit as never), prisma, audit };
}

describe('changing an approval limit (SOD_08)', () => {
  it('refuses a sales director, who approves deals against these very limits', async () => {
    const { service } = policiesService();

    await expect(
      service.set(salesDirector, { key: 'MIN_GROSS_MARGIN_PERCENT', value: 5 } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('records the blocked attempt rather than failing silently', async () => {
    const { service, audit } = policiesService();

    await expect(
      service.set(salesDirector, { key: 'MIN_GROSS_MARGIN_PERCENT', value: 5 } as never),
    ).rejects.toThrow();

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'SOD_BLOCKED',
        after: expect.objectContaining({ rule: 'SOD_08' }),
      }),
    );
  });

  it('allows finance and executive management', async () => {
    const { service, prisma } = policiesService();

    await service.set(ceo, { key: 'MIN_GROSS_MARGIN_PERCENT', value: 12 } as never);

    expect(prisma.approvalPolicy.create).toHaveBeenCalled();
  });

  it('records the change with both the old and new number', async () => {
    const { service, prisma, audit } = policiesService();
    prisma.approvalPolicy.findFirst.mockResolvedValue({ id: 'old', value: 20 });

    await service.set(ceo, { key: 'MIN_GROSS_MARGIN_PERCENT', value: 8 } as never);

    // "Who lowered the margin floor, and from what" is the first question
    // asked about a surprising approval.
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        before: { value: 20 },
        after: expect.objectContaining({ value: 8 }),
      }),
    );
  });

  it('closes the previous row instead of overwriting it', async () => {
    const { service, prisma } = policiesService();
    prisma.approvalPolicy.findFirst.mockResolvedValue({ id: 'old', value: 20 });

    await service.set(ceo, { key: 'MIN_GROSS_MARGIN_PERCENT', value: 8 } as never);

    // An approval granted last month must stay explainable with last month's
    // number.
    expect(prisma.approvalPolicy.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'old' } }),
    );
  });

  it('rejects a percentage outside 0..100 as a typo, not a policy', async () => {
    const { service } = policiesService();

    await expect(
      service.set(ceo, { key: 'MIN_GROSS_MARGIN_PERCENT', value: 1200 } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reports unset limits by name rather than omitting them', async () => {
    const { service } = policiesService([]);

    const result = await service.effective(ceo, {} as never);

    // A screen that just does not mention a limit reads as "no concern here".
    expect(result.unconfigured).toContain('MIN_GROSS_MARGIN_PERCENT');
    expect(result.keys.every((k) => k.configured === false)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SOD_04 — discounts
// ---------------------------------------------------------------------------

function discountsService(opts: { ceiling?: number | null; requestedById?: string } = {}) {
  const request = {
    id: 'dsc-1',
    opportunityId: 'opp-1',
    status: 'PENDING',
    requestedById: opts.requestedById ?? 'someone-else',
  };
  const prisma = {
    discountRequest: {
      findFirst: jest.fn().mockResolvedValue(request),
      create: jest.fn().mockImplementation(({ data }) => ({ id: 'dsc-1', ...data })),
      update: jest.fn().mockImplementation(({ data }) => ({ ...request, ...data })),
    },
  };
  const audit = { record: jest.fn() };
  const service = new DiscountsService(
    prisma as never,
    audit as never,
    { next: jest.fn().mockResolvedValue('DSC-2026-000001') } as never,
    {
      assert: jest.fn().mockResolvedValue({ id: 'opp-1', country: 'EG', orgUnitId: 'org-1' }),
    } as never,
    { valueOf: jest.fn().mockResolvedValue(opts.ceiling ?? null) } as never,
  );
  return { service, prisma, audit };
}

describe('discount requests (SOD_04)', () => {
  it('needs nobody when it is inside the delegated ceiling', async () => {
    const { service } = discountsService({ ceiling: 10 });

    const result = await service.create(salesDirector, 'opp-1', {
      requestedPercent: 5,
      fromPrice: 100,
      toPrice: 95,
      justification: 'Repeat customer',
    });

    expect(result.status).toBe('APPROVED');
  });

  it('waits for a decision above the ceiling', async () => {
    const { service } = discountsService({ ceiling: 10 });

    const result = await service.create(salesDirector, 'opp-1', {
      requestedPercent: 25,
      fromPrice: 100,
      toPrice: 75,
      justification: 'Competitive pressure',
    });

    expect(result.status).toBe('PENDING');
  });

  it('waits when no ceiling has been configured at all', async () => {
    // Silence is not permission.
    const { service } = discountsService({ ceiling: null });

    const result = await service.create(salesDirector, 'opp-1', {
      requestedPercent: 1,
      fromPrice: 100,
      toPrice: 99,
      justification: 'Rounding',
    });

    expect(result.status).toBe('PENDING');
    expect(result.ceilingConfigured).toBe(false);
  });

  it('refuses a "discount" that raises the price', async () => {
    const { service } = discountsService({ ceiling: 10 });

    await expect(
      service.create(salesDirector, 'opp-1', {
        requestedPercent: 5,
        fromPrice: 100,
        toPrice: 120,
        justification: 'Typo',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('blocks the requester from approving their own discount', async () => {
    const { service } = discountsService({ requestedById: salesDirector.id });

    await expect(
      service.decide(salesDirector, 'dsc-1', { approve: true }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('records that blocked attempt as SOD_04', async () => {
    const { service, audit } = discountsService({ requestedById: salesDirector.id });

    await expect(service.decide(salesDirector, 'dsc-1', { approve: true })).rejects.toThrow();

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'SOD_BLOCKED',
        after: expect.objectContaining({ rule: 'SOD_04' }),
      }),
    );
  });

  it('lets a different person decide it', async () => {
    const { service, prisma } = discountsService({ requestedById: 'someone-else' });

    await service.decide(ceo, 'dsc-1', { approve: true });

    expect(prisma.discountRequest.update).toHaveBeenCalled();
  });

  it('demands a reason for a refusal', async () => {
    const { service } = discountsService({ requestedById: 'someone-else' });

    await expect(service.decide(ceo, 'dsc-1', { approve: false })).rejects.toThrow(/reason/i);
  });
});

// ---------------------------------------------------------------------------
// The spec's hard rule on commercial proposals
// ---------------------------------------------------------------------------

function proposalsService(costing: unknown = null) {
  const prisma = {
    proposal: {
      findFirst: jest.fn().mockResolvedValue({ id: 'prp-1', opportunityId: 'opp-1' }),
      create: jest.fn(),
    },
    costingVersion: { findFirst: jest.fn().mockResolvedValue(costing) },
    proposalVersion: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }) => ({ id: 'pv-1', ...data })),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn().mockResolvedValue([{ id: 'pv-1', status: 'SUBMITTED' }]),
  };
  const service = new ProposalsService(
    prisma as never,
    { record: jest.fn() } as never,
    { next: jest.fn().mockResolvedValue('PRP-2026-000001') } as never,
    { assert: jest.fn().mockResolvedValue({ id: 'opp-1' }) } as never,
    { dispatchEvent: jest.fn() } as never,
  );
  return { service, prisma };
}

describe('a commercial proposal needs an approved costing', () => {
  it('refuses a price with no costing behind it at all', async () => {
    const { service } = proposalsService();

    await expect(
      service.addVersion(ceo, 'prp-1', { type: 'COMMERCIAL', sellingPrice: 500_000 } as never),
    ).rejects.toThrow(/approved costing/i);
  });

  it('refuses a costing that is still a draft', async () => {
    // A draft is a work in progress; quoting from one quotes a number that can
    // still move underneath the offer.
    const { service } = proposalsService({
      id: 'cv-1',
      status: 'DRAFT',
      totalPrice: 500_000,
      scenario: { opportunityId: 'opp-1', currency: 'USD' },
    });

    await expect(
      service.addVersion(ceo, 'prp-1', {
        type: 'COMMERCIAL',
        costingVersionId: 'cv-1',
      } as never),
    ).rejects.toThrow(/DRAFT/);
  });

  it('refuses a costing belonging to another opportunity', async () => {
    const { service } = proposalsService({
      id: 'cv-1',
      status: 'APPROVED',
      totalPrice: 500_000,
      scenario: { opportunityId: 'opp-999', currency: 'USD' },
    });

    await expect(
      service.addVersion(ceo, 'prp-1', {
        type: 'COMMERCIAL',
        costingVersionId: 'cv-1',
      } as never),
    ).rejects.toThrow(/different opportunity/i);
  });

  it('refuses a price that contradicts the costing it cites', async () => {
    // Otherwise the reference becomes decoration and the rule is defeated by
    // anyone willing to attach a costing and type a different number.
    const { service } = proposalsService({
      id: 'cv-1',
      status: 'APPROVED',
      totalPrice: 500_000,
      scenario: { opportunityId: 'opp-1', currency: 'USD' },
    });

    await expect(
      service.addVersion(ceo, 'prp-1', {
        type: 'COMMERCIAL',
        costingVersionId: 'cv-1',
        sellingPrice: 400_000,
      } as never),
    ).rejects.toThrow(/does not match/i);
  });

  it('accepts the approved costing and its own price', async () => {
    const { service, prisma } = proposalsService({
      id: 'cv-1',
      status: 'APPROVED',
      totalPrice: 500_000,
      scenario: { opportunityId: 'opp-1', currency: 'USD' },
    });

    await service.addVersion(ceo, 'prp-1', {
      type: 'COMMERCIAL',
      costingVersionId: 'cv-1',
      sellingPrice: 500_000,
    } as never);

    expect(prisma.proposalVersion.create).toHaveBeenCalled();
  });

  it('lets a purely technical proposal exist without one', async () => {
    // It carries no price, so the rule has nothing to protect.
    const { service, prisma } = proposalsService();

    await service.addVersion(ceo, 'prp-1', { type: 'TECHNICAL' } as never);

    expect(prisma.proposalVersion.create).toHaveBeenCalled();
  });

  it('numbers versions in sequence', async () => {
    const { service, prisma } = proposalsService();
    prisma.proposalVersion.findFirst.mockResolvedValue({ versionNumber: 3 });

    const v = await service.addVersion(ceo, 'prp-1', { type: 'TECHNICAL' } as never);

    expect(v.versionNumber).toBe(4);
  });
});

describe('a sent proposal is never replaced', () => {
  it('refuses to send the same version twice', async () => {
    const { service, prisma } = proposalsService();
    prisma.proposalVersion.findFirst.mockResolvedValue({
      id: 'pv-1',
      proposalId: 'prp-1',
      status: 'SUBMITTED',
      versionNumber: 1,
      proposal: { id: 'prp-1', opportunityId: 'opp-1', title: 'Offer' },
    });

    await expect(service.submit(ceo, 'pv-1', {})).rejects.toThrow(/revision/i);
  });

  it('supersedes the earlier sent version in the same act', async () => {
    const { service, prisma } = proposalsService();
    prisma.proposalVersion.findFirst.mockResolvedValue({
      id: 'pv-2',
      proposalId: 'prp-1',
      status: 'DRAFT',
      versionNumber: 2,
      proposal: { id: 'prp-1', opportunityId: 'opp-1', title: 'Offer' },
    });

    await service.submit(ceo, 'pv-2', { submittedTo: 'Customer' });

    // Two rows both claiming to be the live offer is the failure this avoids.
    expect(prisma.$transaction).toHaveBeenCalled();
  });
});
