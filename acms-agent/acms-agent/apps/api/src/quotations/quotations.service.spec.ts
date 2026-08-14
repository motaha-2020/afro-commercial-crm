import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { QuotationsService } from './quotations.service';
import type { AuthenticatedUser } from '../auth/auth.types';

const user: AuthenticatedUser = {
  id: 'user-1',
  email: 'procurement@afro.example',
  orgUnitId: 'org-1',
  roles: [{ role: 'PROCUREMENT', scope: 'GROUP' }],
};

interface QuoteOpts {
  isSelected?: boolean;
  blacklisted?: boolean;
  approvalStatus?: string;
  validUntil?: Date | null;
  recommenderId?: string | null;
  /** Other quotations on the same opportunity, used to build the comparison. */
  rivals?: { id: string; total: number; weighted: number }[];

  // --- the costing link ---
  /** Quotation lines and the BOQ item each was quoted against. */
  lines?: { boqItemId: string | null; unitPrice: number; totalPrice: number }[];
  /** Cost lines already sitting on that BOQ item. */
  existing?: { id: string; source: string; totalCost: number }[];
  partnerTypes?: string[];
  versionStatus?: string;
  versionLocked?: boolean;
  scenarioCurrency?: string;
  /** The opportunity the BOQ item actually belongs to. */
  boqOpportunityId?: string;
  boqMissing?: boolean;
}

function build(opts: QuoteOpts = {}) {
  const subject = {
    id: 'quo-1',
    code: 'QUO-2026-000001',
    partnerId: 'ptr-1',
    opportunityId: 'opp-1',
    isSelected: opts.isSelected ?? false,
    validUntil: opts.validUntil === undefined ? null : opts.validUntil,
    totalValue: 100_000,
    landedAdjustment: null,
    deliveryDays: 30,
    currency: 'USD',
    technicalStatus: 'COMPLIANT',
    commercialStatus: 'ACCEPTABLE',
    partner: {
      id: 'ptr-1',
      legalName: 'Cable Co',
      isBlacklisted: opts.blacklisted ?? false,
      approvalStatus: opts.approvalStatus ?? 'APPROVED',
    },
    evaluations: opts.recommenderId
      ? [
          {
            id: 'ev-1',
            evaluatorId: opts.recommenderId,
            recommendation: 'Best fit',
            technicalScore: 4,
            weightedScore: 80,
          },
        ]
      : [],
    items: [],
  };

  // listQuotations feeds compare(); include the subject plus any rivals.
  const all = [
    subject,
    ...(opts.rivals ?? []).map((r) => ({
      ...subject,
      id: r.id,
      code: r.id,
      partnerId: `ptr-${r.id}`,
      isSelected: false,
      totalValue: r.total,
      partner: { ...subject.partner, id: `ptr-${r.id}`, legalName: `Rival ${r.id}` },
      evaluations: [
        { id: `ev-${r.id}`, evaluatorId: 'someone', recommendation: null, technicalScore: 3, weightedScore: r.weighted },
      ],
    })),
  ];

  const lines = (opts.lines ?? []).map((l, i) => ({
    id: `qli-${i}`,
    boqItemId: l.boqItemId,
    description: 'Fibre cable 24F',
    quantity: 1000,
    unit: 'm',
    unitPrice: l.unitPrice,
    totalPrice: l.totalPrice,
  }));

  const existing = (opts.existing ?? []).map((e) => ({ ...e }));

  const boqItem = opts.boqMissing
    ? null
    : {
        id: 'boq-1',
        sellingTotal: 20_000,
        quantity: 1000,
        breakdown: existing,
        package: {
          version: {
            id: 'ver-1',
            status: opts.versionStatus ?? 'DRAFT',
            lockedAt: opts.versionLocked ? new Date() : null,
            scenario: {
              id: 'scn-1',
              currency: opts.scenarioCurrency ?? 'USD',
              opportunityId: opts.boqOpportunityId ?? 'opp-1',
            },
          },
        },
      };

  const prisma = {
    partnerQuotation: {
      findFirst: jest.fn().mockResolvedValue(subject),
      findUnique: jest.fn().mockResolvedValue({
        ...subject,
        items: lines,
        partner: {
          ...subject.partner,
          types: (opts.partnerTypes ?? ['SUPPLIER']).map((type) => ({ type })),
        },
      }),
      findMany: jest.fn().mockResolvedValue(all),
      update: jest.fn().mockImplementation(({ data }) => ({ ...subject, ...data })),
      updateMany: jest.fn(),
    },
    boqItem: {
      findFirst: jest.fn().mockResolvedValue(boqItem),
      // Read back after the write, so the surviving lines are what recalculate
      // sees — the same order the service performs them in.
      findUnique: jest.fn().mockImplementation(async () => ({
        ...boqItem,
        breakdown: [
          ...existing.filter((e) => !['MANUAL_ESTIMATE', 'HISTORICAL_RATE', 'MARKET_BENCHMARK', 'VENDOR_QUOTE', 'SUBCONTRACTOR_QUOTE'].includes(e.source)),
          ...lines.filter((l) => l.boqItemId).map((l) => ({ totalCost: l.totalPrice })),
        ],
      })),
      update: jest.fn(),
    },
    costBreakdown: {
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn().mockImplementation(async (arg: unknown) => {
      // The service uses both forms: an array for the selection itself, a
      // callback for each costing write.
      if (typeof arg === 'function') {
        return (arg as (tx: unknown) => Promise<unknown>)(prisma);
      }
      return [{ ...subject, isSelected: true }];
    }),
  };

  const service = new QuotationsService(
    prisma as never,
    { record: jest.fn(), recordUpdate: jest.fn() } as never,
    { next: jest.fn() } as never,
    { buildFilter: jest.fn().mockResolvedValue({}) } as never,
    { assert: jest.fn().mockResolvedValue({ id: 'opp-1' }) } as never,
    { dispatchEvent: jest.fn() } as never,
  );

  return { service, prisma };
}

describe('selecting a quotation', () => {
  it('refuses a blacklisted partner outright, not with a warning', async () => {
    const { service } = build({ blacklisted: true });

    await expect(service.select(user, 'quo-1', {})).rejects.toThrow(/blacklisted/i);
  });

  it('refuses a suspended partner', async () => {
    const { service } = build({ approvalStatus: 'SUSPENDED' });

    await expect(service.select(user, 'quo-1', {})).rejects.toThrow(/suspended/i);
  });

  it('refuses an expired offer — an old price is not a current one', async () => {
    const { service } = build({ validUntil: new Date('2020-01-01') });

    await expect(service.select(user, 'quo-1', {})).rejects.toThrow(/expired/i);
  });

  it('refuses to select the same quotation twice', async () => {
    const { service } = build({ isSelected: true });

    await expect(service.select(user, 'quo-1', {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('blocks the person who wrote the recommendation (SOD_03)', async () => {
    const { service } = build({ recommenderId: user.id });

    await expect(service.select(user, 'quo-1', {})).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('records the blocked attempt, because a refused try is evidence too', async () => {
    const { service } = build({ recommenderId: user.id });
    const audit = (service as unknown as { audit: { record: jest.Mock } }).audit;

    await expect(service.select(user, 'quo-1', {})).rejects.toThrow();

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SOD_BLOCKED', after: expect.objectContaining({ rule: 'SOD_03' }) }),
    );
  });

  it('lets a different person act on someone else\'s recommendation', async () => {
    const { service, prisma } = build({ recommenderId: 'someone-else' });

    await service.select(user, 'quo-1', {});

    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('demands a reason when the choice is not the recommended offer', async () => {
    // A rival scores higher, so the subject is not what the system recommends.
    const { service } = build({ rivals: [{ id: 'quo-2', total: 90_000, weighted: 95 }] });

    await expect(service.select(user, 'quo-1', {})).rejects.toThrow(/recommended/i);
  });

  it('accepts the departure once a reason is written', async () => {
    const { service, prisma } = build({ rivals: [{ id: 'quo-2', total: 90_000, weighted: 95 }] });

    await service.select(user, 'quo-1', { rationale: 'Only bidder who can start in March' });

    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('needs no reason when the choice matches the recommendation', async () => {
    const { service, prisma } = build({
      recommenderId: 'someone-else',
      rivals: [{ id: 'quo-2', total: 50_000, weighted: 10 }],
    });

    await service.select(user, 'quo-1', {});

    expect(prisma.$transaction).toHaveBeenCalled();
  });
});

describe('the selected quotation reaching the costing', () => {
  const quoted = [{ boqItemId: 'boq-1', unitPrice: 9, totalPrice: 9_000 }];

  it('writes the quoted price into the BOQ item as a vendor quote', async () => {
    const { service, prisma } = build({ recommenderId: 'someone-else', lines: quoted });

    const result = await service.select(user, 'quo-1', {});

    expect(prisma.costBreakdown.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          boqItemId: 'boq-1',
          unitCost: 9,
          totalCost: 9_000,
          source: 'VENDOR_QUOTE',
        }),
      }),
    );
    expect(result.costing.applied).toBe(1);
  });

  it('names the quotation on the line, so the number can be traced back', async () => {
    const { service, prisma } = build({ recommenderId: 'someone-else', lines: quoted });

    await service.select(user, 'quo-1', {});

    expect(prisma.costBreakdown.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sourceReference: expect.stringContaining('QUO-2026-000001'),
        }),
      }),
    );
  });

  it('records a subcontractor quote as one when the partner installs too', async () => {
    const { service, prisma } = build({
      recommenderId: 'someone-else',
      lines: quoted,
      partnerTypes: ['SUPPLIER', 'SUBCONTRACTOR'],
    });

    await service.select(user, 'quo-1', {});

    expect(prisma.costBreakdown.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ source: 'SUBCONTRACTOR_QUOTE' }) }),
    );
  });

  it('supersedes the estimate it replaces instead of adding to it', async () => {
    // The double-counting bug this whole design exists to prevent: a guess of
    // 12,000 plus a quote of 9,000 would price the item at 21,000.
    const { service, prisma } = build({
      recommenderId: 'someone-else',
      lines: quoted,
      existing: [{ id: 'cb-1', source: 'MANUAL_ESTIMATE', totalCost: 12_000 }],
    });

    const result = await service.select(user, 'quo-1', {});

    expect(prisma.costBreakdown.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['cb-1'] } } }),
    );
    expect(result.costing.superseded).toBe(1);
    expect(prisma.boqItem.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ internalCost: 9_000 }) }),
    );
  });

  it('keeps our own crew cost, which the supplier never quoted for', async () => {
    const { service, prisma } = build({
      recommenderId: 'someone-else',
      lines: quoted,
      existing: [
        { id: 'cb-1', source: 'MANUAL_ESTIMATE', totalCost: 12_000 },
        { id: 'cb-2', source: 'INTERNAL_RATE', totalCost: 3_000 },
      ],
    });

    const result = await service.select(user, 'quo-1', {});

    expect(prisma.costBreakdown.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['cb-1'] } } }),
    );
    expect(result.costing.retained).toBe(1);
    // 9,000 quoted + 3,000 our own supervision — not 24,000.
    expect(prisma.boqItem.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ internalCost: 12_000 }) }),
    );
  });

  it('records every superseded estimate, so the old view stays answerable', async () => {
    const { service } = build({
      recommenderId: 'someone-else',
      lines: quoted,
      existing: [{ id: 'cb-1', source: 'MANUAL_ESTIMATE', totalCost: 12_000 }],
    });
    const audit = (service as unknown as { audit: { record: jest.Mock } }).audit;

    await service.select(user, 'quo-1', {});

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'CostBreakdown',
        entityId: 'cb-1',
        before: expect.objectContaining({ totalCost: 12_000 }),
        after: expect.objectContaining({ supersededBy: 'QUO-2026-000001' }),
      }),
    );
  });

  it('never edits an approved costing, and says so rather than failing quietly', async () => {
    const { service, prisma } = build({
      recommenderId: 'someone-else',
      lines: quoted,
      versionStatus: 'APPROVED',
      versionLocked: true,
    });

    const result = await service.select(user, 'quo-1', {});

    expect(prisma.costBreakdown.create).not.toHaveBeenCalled();
    expect(result.costing.skipped).toEqual([{ reason: 'COSTING_LOCKED', count: 1 }]);
  });

  it('still lets the selection stand when the costing is locked', async () => {
    // Procurement's decision is not invalidated by the costing being frozen.
    const { service } = build({
      recommenderId: 'someone-else',
      lines: quoted,
      versionLocked: true,
    });

    await expect(service.select(user, 'quo-1', {})).resolves.toMatchObject({
      isSelected: true,
    });
  });

  it('warns somebody when the costing did not follow the decision', async () => {
    const { service } = build({
      recommenderId: 'someone-else',
      lines: quoted,
      versionLocked: true,
    });
    const notifications = (service as unknown as { notifications: { dispatchEvent: jest.Mock } })
      .notifications;

    await service.select(user, 'quo-1', {});

    expect(notifications.dispatchEvent).toHaveBeenCalledWith(
      'QUOTATION_SELECTED',
      expect.objectContaining({ title: expect.stringMatching(/not updated/i) }),
    );
  });

  it('refuses to convert currencies rather than inventing a rate', async () => {
    const { service, prisma } = build({
      recommenderId: 'someone-else',
      lines: quoted,
      scenarioCurrency: 'EUR',
    });

    const result = await service.select(user, 'quo-1', {});

    expect(prisma.costBreakdown.create).not.toHaveBeenCalled();
    expect(result.costing.skipped).toEqual([{ reason: 'CURRENCY_MISMATCH', count: 1 }]);
  });

  it('refuses a BOQ item belonging to another opportunity', async () => {
    const { service, prisma } = build({
      recommenderId: 'someone-else',
      lines: quoted,
      boqOpportunityId: 'opp-999',
    });

    const result = await service.select(user, 'quo-1', {});

    expect(prisma.costBreakdown.create).not.toHaveBeenCalled();
    expect(result.costing.skipped).toEqual([{ reason: 'BOQ_ITEM_FOREIGN', count: 1 }]);
  });

  it('reports unmapped lines instead of pretending the whole quote landed', async () => {
    const { service } = build({
      recommenderId: 'someone-else',
      lines: [
        { boqItemId: 'boq-1', unitPrice: 9, totalPrice: 9_000 },
        { boqItemId: null, unitPrice: 500, totalPrice: 500 },
      ],
    });

    const result = await service.select(user, 'quo-1', {});

    expect(result.costing.applied).toBe(1);
    expect(result.costing.skipped).toEqual([{ reason: 'NOT_MAPPED_TO_BOQ', count: 1 }]);
  });

  it('does not reprice the item — a cheaper supplier is not a decision to sell for less', async () => {
    const { service, prisma } = build({ recommenderId: 'someone-else', lines: quoted });

    await service.select(user, 'quo-1', {});

    const written = prisma.boqItem.update.mock.calls[0][0].data;
    expect(written.sellingTotal).toBeUndefined();
    expect(written.sellingRate).toBeUndefined();
    // The margin follows from the price staying put and the cost dropping.
    expect(written.grossMargin).toBe(55);
  });

  it('does nothing at all when no line was mapped to the BOQ', async () => {
    const { service, prisma } = build({ recommenderId: 'someone-else', lines: [] });

    const result = await service.select(user, 'quo-1', {});

    expect(prisma.boqItem.findFirst).not.toHaveBeenCalled();
    expect(result.costing.applied).toBe(0);
  });
});

describe('the comparison itself', () => {
  it('never marks anything selected — it only reports', async () => {
    const { service, prisma } = build({ rivals: [{ id: 'quo-2', total: 90_000, weighted: 95 }] });

    const result = await service.compare(user, 'opp-1');

    expect(result.views.recommendedId).toBe('quo-2');
    expect(prisma.partnerQuotation.update).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('publishes the weights so a score is never shown without its basis', async () => {
    const { service } = build();

    const result = await service.compare(user, 'opp-1');

    expect(result.weights.PRICE).toBeGreaterThan(0);
  });
});
