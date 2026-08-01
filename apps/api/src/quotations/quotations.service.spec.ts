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

  const prisma = {
    partnerQuotation: {
      findFirst: jest.fn().mockResolvedValue(subject),
      findMany: jest.fn().mockResolvedValue(all),
      update: jest.fn().mockImplementation(({ data }) => ({ ...subject, ...data })),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn().mockResolvedValue([{ ...subject, isSelected: true }]),
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
