import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ContractsService } from './contracts.service';
import { HandoverService } from './handover.service';
import type { AuthenticatedUser } from '../auth/auth.types';

function userWith(id: string): AuthenticatedUser {
  return {
    id,
    email: `${id}@afro.example`,
    orgUnitId: 'org-1',
    roles: [{ role: 'CEO', scope: 'GROUP' }],
  } as AuthenticatedUser;
}

const preparer = userWith('preparer');
const approver = userWith('approver');

// ---------------------------------------------------------------------------
// SOD_06 — whoever prepares a deviation does not decide it
// ---------------------------------------------------------------------------

function contractsService(deviation: Record<string, unknown> = {}) {
  const row = {
    id: 'dev-1',
    status: 'OPEN',
    riskLevel: 'MEDIUM',
    preparedById: 'preparer',
    contract: { id: 'cnt-1', opportunityId: 'opp-1' },
    ...deviation,
  };
  const prisma = {
    contractDeviation: {
      findFirst: jest.fn().mockResolvedValue(row),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(({ data }) => ({ id: 'dev-new', ...data })),
      update: jest.fn().mockImplementation(({ data }) => ({ ...row, ...data })),
      updateMany: jest.fn(),
    },
    contract: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'cnt-1',
        opportunityId: 'opp-1',
        status: 'DRAFT',
        proposalVersionId: 'pv-1',
        proposalVersion: { id: 'pv-1', sellingPrice: 1_000_000 },
        contractValue: 900_000,
        paymentTerms: null,
        startDate: null,
        endDate: null,
        warrantyMonths: null,
        ldPercent: null,
        liabilityCap: null,
        deviations: [],
        clauses: [],
      }),
      update: jest.fn(),
    },
    proposalVersion: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'pv-1',
        sellingPrice: 1_000_000,
        // Terms the proposal did not state stay null, so the comparison says
        // nothing about them.
        paymentTerms: null,
        durationDays: null,
        warrantyMonths: null,
        ldPercent: null,
        liabilityCap: null,
        proposal: { opportunityId: 'opp-1' },
      }),
    },
    award: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn() },
    opportunity: { findFirst: jest.fn().mockResolvedValue({ id: 'opp-1', accountId: 'acc-1' }) },
    $transaction: jest.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      typeof fn === 'function' ? fn(prisma) : undefined,
    ),
  };
  const audit = { record: jest.fn(), recordUpdate: jest.fn() };
  const service = new ContractsService(
    prisma as never,
    audit as never,
    { next: jest.fn().mockResolvedValue('AWD-2026-000001') } as never,
    { assert: jest.fn().mockResolvedValue({ id: 'opp-1' }) } as never,
    { dispatchEvent: jest.fn() } as never,
  );
  return { service, prisma, audit };
}

describe('deciding a contract deviation (SOD_06)', () => {
  it('blocks whoever prepared it', async () => {
    const { service } = contractsService();

    await expect(
      service.decideDeviation(preparer, 'dev-1', { status: 'ACCEPTED' } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('records the blocked attempt as SOD_06', async () => {
    const { service, audit } = contractsService();

    await expect(
      service.decideDeviation(preparer, 'dev-1', { status: 'ACCEPTED' } as never),
    ).rejects.toThrow();

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'SOD_BLOCKED',
        after: expect.objectContaining({ rule: 'SOD_06' }),
      }),
    );
  });

  it('lets a different person decide it', async () => {
    const { service, prisma } = contractsService();

    await service.decideDeviation(approver, 'dev-1', { status: 'ACCEPTED' } as never);

    expect(prisma.contractDeviation.update).toHaveBeenCalled();
  });

  it('demands a written reason to accept a critical deviation', async () => {
    // Accepting one means accepting unlimited liability or an unpriced
    // penalty. Allowed — but not silently.
    const { service } = contractsService({ riskLevel: 'CRITICAL' });

    await expect(
      service.decideDeviation(approver, 'dev-1', { status: 'ACCEPTED' } as never),
    ).rejects.toThrow(/reason/i);
  });

  it('accepts a critical one once the reason is written', async () => {
    const { service, prisma } = contractsService({ riskLevel: 'CRITICAL' });

    await service.decideDeviation(approver, 'dev-1', {
      status: 'ACCEPTED',
      note: 'Customer will not move; priced the risk into the contingency',
    } as never);

    expect(prisma.contractDeviation.update).toHaveBeenCalled();
  });

  it('demands a reason for a rejection', async () => {
    const { service } = contractsService();

    await expect(
      service.decideDeviation(approver, 'dev-1', { status: 'REJECTED' } as never),
    ).rejects.toThrow(/reason/i);
  });

  it('refuses to decide the same deviation twice', async () => {
    const { service } = contractsService({ status: 'ACCEPTED' });

    await expect(
      service.decideDeviation(approver, 'dev-1', { status: 'REJECTED', note: 'x' } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('reviewing a contract against its proposal', () => {
  it('refuses when no proposal is linked — there is nothing to compare', async () => {
    const { service, prisma } = contractsService();
    prisma.contract.findFirst.mockResolvedValue({
      id: 'cnt-1',
      opportunityId: 'opp-1',
      status: 'DRAFT',
      proposalVersionId: null,
      proposalVersion: null,
      deviations: [],
      clauses: [],
    });

    await expect(service.review(preparer, 'cnt-1')).rejects.toThrow(/compare/i);
  });

  it('records the price difference it finds', async () => {
    const { service, prisma } = contractsService();

    await service.review(preparer, 'cnt-1');

    expect(prisma.contractDeviation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ field: 'PRICE', isDetected: true }),
      }),
    );
  });

  it('says nothing about a term the proposal never stated', async () => {
    // The trap: Number(undefined) is NaN, which compares unequal to
    // everything, so an unstated term would be reported as a deviation on
    // every single contract.
    const { service, prisma } = contractsService();
    prisma.proposalVersion.findUnique.mockResolvedValue({
      id: 'pv-1',
      sellingPrice: 900_000,
      proposal: { opportunityId: 'opp-1' },
      // ldPercent, liabilityCap and the rest simply absent.
    });

    await service.review(preparer, 'cnt-1');

    const fields = prisma.contractDeviation.create.mock.calls.map(
      (c: [{ data: { field: string } }]) => c[0].data.field,
    );
    expect(fields).toEqual([]);
  });

  it('compares the terms once the proposal carries them', async () => {
    const { service, prisma } = contractsService();
    prisma.proposalVersion.findUnique.mockResolvedValue({
      id: 'pv-1',
      sellingPrice: 900_000,
      warrantyMonths: 12,
      ldPercent: 5,
      liabilityCap: 500_000,
      paymentTerms: '30 days net',
      durationDays: null,
      proposal: { opportunityId: 'opp-1' },
    });
    prisma.contract.findFirst.mockResolvedValue({
      id: 'cnt-1',
      opportunityId: 'opp-1',
      status: 'DRAFT',
      proposalVersionId: 'pv-1',
      proposalVersion: { id: 'pv-1' },
      contractValue: 900_000,
      paymentTerms: '90 days net',
      startDate: null,
      endDate: null,
      warrantyMonths: 24,
      ldPercent: 5,
      liabilityCap: 500_000,
      deviations: [],
      clauses: [],
    });

    await service.review(preparer, 'cnt-1');

    const fields = prisma.contractDeviation.create.mock.calls.map(
      (c: [{ data: { field: string } }]) => c[0].data.field,
    );
    // Price and LD match; the warranty and payment terms moved.
    expect(fields.sort()).toEqual(['PAYMENT_TERMS', 'WARRANTY']);
  });

  it('does not overwrite a deviation a person already decided', async () => {
    // Otherwise a second review silently reopens arguments already settled.
    const { service, prisma } = contractsService();
    prisma.contractDeviation.findMany.mockResolvedValue([
      { id: 'dev-old', field: 'PRICE', status: 'ACCEPTED' },
    ]);

    await service.review(preparer, 'cnt-1');

    expect(prisma.contractDeviation.create).not.toHaveBeenCalled();
  });
});

describe('recording an award', () => {
  it('keeps the firmest award, not the latest one', async () => {
    // A customer who phones after sending the purchase order has not
    // un-ordered the work.
    const { service, prisma } = contractsService();
    prisma.award.findMany.mockResolvedValue([
      { type: 'PURCHASE_ORDER' },
      { type: 'VERBAL_AWARD' },
    ]);

    const result = await service.listAwards(preparer, 'opp-1');

    expect(result.strongest).toBe('PURCHASE_ORDER');
    expect(result.isBinding).toBe(true);
  });

  it('reports a verbal award as not binding', async () => {
    const { service, prisma } = contractsService();
    prisma.award.findMany.mockResolvedValue([{ type: 'VERBAL_AWARD' }]);

    const result = await service.listAwards(preparer, 'opp-1');

    expect(result.isBinding).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The handover gate
// ---------------------------------------------------------------------------

function handoverService(opts: {
  awardType?: string;
  reviewedAt?: Date | null;
  pmId?: string | null;
  startDate?: Date | null;
  baselineStatus?: string;
  criticalOpen?: boolean;
  signoffs?: { id: string; party: string; isAccepted: boolean | null }[];
  status?: string;
} = {}) {
  const signoffs =
    opts.signoffs ??
    ['SALES', 'COMMERCIAL', 'FINANCE', 'OPERATIONS', 'PROCUREMENT', 'PROJECT_MANAGER'].map(
      (party, i) => ({ id: `so-${i}`, party, isAccepted: null }),
    );

  const handover = {
    id: 'hnd-1',
    opportunityId: 'opp-1',
    status: opts.status ?? 'DRAFT',
    contract: {
      reviewedAt: opts.reviewedAt === undefined ? new Date('2026-07-01') : opts.reviewedAt,
      contractValue: 1_000_000,
      deviations: opts.criticalOpen
        ? [{ status: 'OPEN', riskLevel: 'CRITICAL' }]
        : [],
    },
    costBaselineVersion: { status: opts.baselineStatus ?? 'APPROVED' },
    projectManagerId: opts.pmId === undefined ? 'pm-1' : opts.pmId,
    plannedStartDate: opts.startDate === undefined ? new Date('2026-09-01') : opts.startDate,
    items: [],
    signoffs,
  };

  const prisma = {
    projectHandover: {
      findFirst: jest.fn().mockResolvedValue(handover),
      create: jest.fn().mockResolvedValue({ id: 'hnd-1' }),
      update: jest.fn(),
    },
    handoverSignoff: {
      update: jest.fn(),
      findMany: jest.fn().mockResolvedValue(signoffs),
    },
    handoverItem: { findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
    award: {
      findMany: jest.fn().mockResolvedValue([{ type: opts.awardType ?? 'CONTRACT_SIGNED' }]),
    },
    contract: { findFirst: jest.fn().mockResolvedValue(handover.contract) },
    scopePackage: {
      findMany: jest.fn().mockResolvedValue([{ items: [{ id: 'i1' }] }]),
    },
    assumption: { findMany: jest.fn().mockResolvedValue([]) },
    clarification: { findMany: jest.fn().mockResolvedValue([]) },
  };

  const service = new HandoverService(
    prisma as never,
    { record: jest.fn(), recordUpdate: jest.fn() } as never,
    { next: jest.fn().mockResolvedValue('HND-2026-000001') } as never,
    { assert: jest.fn().mockResolvedValue({ id: 'opp-1' }) } as never,
    { dispatchEvent: jest.fn() } as never,
  );
  return { service, prisma };
}

describe('the gate before a project is handed over', () => {
  it('is ready when every condition is met', async () => {
    const { service } = handoverService();

    const result = await service.findOne(preparer, 'hnd-1');

    expect(result.readiness.ready).toBe(true);
  });

  it('refuses a project won by phone call', async () => {
    const { service } = handoverService({ awardType: 'VERBAL_AWARD' });

    const result = await service.findOne(preparer, 'hnd-1');

    expect(result.readiness.ready).toBe(false);
    expect(result.readiness.missing).toContain('BINDING_AWARD');
  });

  it('blocks on an unresolved critical deviation', async () => {
    const { service } = handoverService({ criticalOpen: true });

    const result = await service.findOne(preparer, 'hnd-1');

    expect(result.readiness.missing).toContain('DEVIATIONS_RESOLVED');
  });

  it('blocks on a cost baseline that is not approved', async () => {
    const { service } = handoverService({ baselineStatus: 'DRAFT' });

    const result = await service.findOne(preparer, 'hnd-1');

    expect(result.readiness.missing).toContain('COST_BASELINE_APPROVED');
  });

  it('will not let anyone accept a pack that is not ready', async () => {
    const { service } = handoverService({ awardType: 'VERBAL_AWARD' });

    await expect(
      service.sign(preparer, 'hnd-1', { party: 'SALES', accept: true } as never),
    ).rejects.toThrow(/not ready/i);
  });

  it('demands a reason for a refusal', async () => {
    const { service } = handoverService();

    await expect(
      service.sign(preparer, 'hnd-1', { party: 'OPERATIONS', accept: false } as never),
    ).rejects.toThrow(/reason/i);
  });

  it('records a refusal and stops the handover', async () => {
    const { service, prisma } = handoverService();
    prisma.handoverSignoff.findMany.mockResolvedValue([
      { party: 'SALES', isAccepted: true },
      { party: 'COMMERCIAL', isAccepted: true },
      { party: 'FINANCE', isAccepted: true },
      { party: 'OPERATIONS', isAccepted: true },
      { party: 'PROCUREMENT', isAccepted: true },
      { party: 'PROJECT_MANAGER', isAccepted: false },
    ]);

    await service.sign(preparer, 'hnd-1', {
      party: 'PROJECT_MANAGER',
      accept: false,
      comment: 'The schedule cannot be delivered with the priced crew',
    } as never);

    // Five acceptances do not outvote the person who has to deliver it.
    expect(prisma.projectHandover.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'REJECTED' }) }),
    );
  });

  it('completes only when every required party has accepted', async () => {
    const { service, prisma } = handoverService();
    prisma.handoverSignoff.findMany.mockResolvedValue(
      ['SALES', 'COMMERCIAL', 'FINANCE', 'OPERATIONS', 'PROCUREMENT', 'PROJECT_MANAGER'].map(
        (party) => ({ party, isAccepted: true }),
      ),
    );

    await service.sign(preparer, 'hnd-1', { party: 'PROJECT_MANAGER', accept: true } as never);

    expect(prisma.projectHandover.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED' }) }),
    );
  });

  it('refuses a second answer from the same party', async () => {
    const { service } = handoverService({
      signoffs: [
        { id: 'so-0', party: 'SALES', isAccepted: true },
        { id: 'so-1', party: 'PROJECT_MANAGER', isAccepted: null },
      ],
    });

    await expect(
      service.sign(preparer, 'hnd-1', { party: 'SALES', accept: false, comment: 'x' } as never),
    ).rejects.toThrow(/already answered/i);
  });
});

describe('the handover checklist', () => {
  it('makes "not applicable" cost a reason', async () => {
    // Otherwise an item nobody did and an item that does not apply read alike.
    const { service, prisma } = handoverService();
    prisma.handoverItem.findFirst.mockResolvedValue({
      id: 'itm-1',
      handover: { id: 'hnd-1', opportunityId: 'opp-1', status: 'DRAFT' },
    });

    await expect(
      service.updateItem(preparer, 'itm-1', { notApplicable: true } as never),
    ).rejects.toThrow(/reason/i);
  });

  it('accepts it with one', async () => {
    const { service, prisma } = handoverService();
    prisma.handoverItem.findFirst.mockResolvedValue({
      id: 'itm-1',
      handover: { id: 'hnd-1', opportunityId: 'opp-1', status: 'DRAFT' },
    });
    prisma.handoverItem.update.mockResolvedValue({
      id: 'itm-1',
      isComplete: false,
      notApplicable: true,
      notApplicableReason: 'No subcontractors on this scope',
    });

    await service.updateItem(preparer, 'itm-1', {
      notApplicable: true,
      notApplicableReason: 'No subcontractors on this scope',
    } as never);

    expect(prisma.handoverItem.update).toHaveBeenCalled();
  });
});
