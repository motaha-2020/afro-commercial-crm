import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AssessmentService } from './assessment.service';
import type { AuthenticatedUser } from '../auth/auth.types';

const presales: AuthenticatedUser = {
  id: 'user-1',
  email: 'presales@afro.example',
  orgUnitId: 'org-1',
  roles: [{ role: 'PRESALES', scope: 'OWN' }],
};

const director: AuthenticatedUser = {
  ...presales,
  id: 'user-2',
  email: 'director@afro.example',
  roles: [{ role: 'SALES_DIRECTOR', scope: 'COUNTRY' }],
};

function build(overrides: Record<string, unknown> = {}) {
  const created: Record<string, unknown>[] = [];
  const prisma = {
    bidScoringWeight: {
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn(),
    },
    bidAssessment: {
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return Promise.resolve({ id: 'assessment-1', ...data });
      }),
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'assessment-1', ...data }),
      ),
    },
    opportunity: {
      update: jest.fn().mockResolvedValue({}),
      // Read to resolve which Bid/No-Bid bands apply to this opportunity.
      findUnique: jest.fn().mockResolvedValue({ country: 'EG', orgUnitId: 'org-1' }),
    },
    $transaction: jest.fn().mockResolvedValue([]),
    ...overrides,
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const access = {
    assert: jest.fn().mockResolvedValue({ id: 'opp-1', code: 'OPP-2026-000001' }),
    assertVia: jest.fn().mockResolvedValue({ id: 'opp-1', code: 'OPP-2026-000001' }),
  };
  const notifications = { dispatchEvent: jest.fn().mockResolvedValue(1) };
  // The Bid/No-Bid bands now come from the approval-policy settings; the
  // existing tests pin the provisional 70/55 so they keep asserting the same
  // decisions while the source of the numbers moves.
  const policies = {
    valueOf: jest.fn().mockImplementation(async (key: string) =>
      key === 'BID_GO_THRESHOLD' ? 70 : 55,
    ),
  };

  return {
    service: new AssessmentService(
      prisma as never,
      audit as never,
      policies as never,
      access as never,
      notifications as never,
    ),
    policies,
    prisma,
    audit,
    notifications,
    created,
  };
}

describe('AssessmentService — scoring', () => {
  it('scores a full assessment and writes the total onto the opportunity', async () => {
    const { service, prisma } = build();

    const result = await service.assess(presales, 'opp-1', {
      ratings: {
        RELATIONSHIP_STRENGTH: 5,
        TECHNICAL_FIT: 5,
        DELIVERY_CAPACITY: 5,
        EXPECTED_PROFITABILITY: 5,
        PAYMENT_TERMS: 5,
        COMPETITION: 5,
        SCOPE_CLARITY: 5,
        STRATEGIC_VALUE: 5,
      },
    });

    expect(result.score).toBe(100);
    expect(result.suggestedDecision).toBe('BID');
    // The stage gate out of OPPORTUNITY_QUALIFICATION reads bidNoBidScore.
    expect(prisma.opportunity.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { bidNoBidScore: 100 } }),
    );
  });

  it('stores the weights in force, so an old score stays reproducible', async () => {
    const { service, created } = build();
    await service.assess(presales, 'opp-1', { ratings: { TECHNICAL_FIT: 4 } });
    expect(created[0].weights).toMatchObject({ TECHNICAL_FIT: 15, COMPETITION: 10 });
  });

  it('reports the factors nobody rated', async () => {
    const { service } = build();
    const result = await service.assess(presales, 'opp-1', {
      ratings: { RELATIONSHIP_STRENGTH: 5 },
    });
    expect(result.unrated).toHaveLength(7);
    expect(result.score).toBe(15);
  });

  it('rejects an invented factor', async () => {
    const { service } = build();
    await expect(
      service.assess(presales, 'opp-1', { ratings: { GUT_FEELING: 5 } }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a rating outside the scale', async () => {
    const { service } = build();
    await expect(
      service.assess(presales, 'opp-1', { ratings: { TECHNICAL_FIT: 9 } }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('fills gaps from the defaults when only some weights are configured', async () => {
    // A partial row set would otherwise score out of less than 100.
    const { service } = build({
      bidScoringWeight: {
        findMany: jest.fn().mockResolvedValue([{ factor: 'TECHNICAL_FIT', weight: 15 }]),
        upsert: jest.fn(),
      },
    });
    const weights = await service.currentWeights();
    expect(Object.values(weights).reduce((a, b) => a + b, 0)).toBe(100);
  });
});

describe('AssessmentService — the decision', () => {
  const assessment = {
    id: 'assessment-1',
    opportunityId: 'opp-1',
    score: 82,
    suggestedDecision: 'BID',
    decision: null,
  };

  function withAssessment() {
    return build({
      bidAssessment: {
        create: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(assessment),
        update: jest.fn(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 'assessment-1', ...data }),
        ),
      },
    });
  }

  it('records a decision that agrees with the suggestion', async () => {
    const { service, notifications } = withAssessment();
    const result = await service.decide(director, 'assessment-1', { decision: 'BID' });
    expect(result.decision).toBe('BID');
    expect(notifications.dispatchEvent).toHaveBeenCalledWith(
      'BID_DECISION_RECORDED',
      expect.anything(),
    );
  });

  it('refuses to override the suggestion silently', async () => {
    // Walking away from an 82-point pursuit may be right — but not unexplained.
    const { service } = withAssessment();
    await expect(
      service.decide(director, 'assessment-1', { decision: 'NO_BID' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows the override once a reason is given, and marks it as one', async () => {
    const { service, audit } = withAssessment();
    await service.decide(director, 'assessment-1', {
      decision: 'NO_BID',
      rationale: 'Customer payment history is unacceptable despite the score',
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ after: expect.objectContaining({ overrode: true }) }),
    );
  });
});

describe('AssessmentService — weights are governed', () => {
  it('refuses a re-weighting by someone without commercial authority', async () => {
    const { service } = build();
    await expect(
      service.updateWeights(presales, { weights: { TECHNICAL_FIT: 100 } }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses weights that do not total 100 even from an authorised role', async () => {
    const { service } = build();
    await expect(
      service.updateWeights(director, { weights: { TECHNICAL_FIT: 100 } }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts a valid re-weighting and audits it', async () => {
    const { service, audit } = build();
    await service.updateWeights(director, {
      weights: {
        RELATIONSHIP_STRENGTH: 20,
        TECHNICAL_FIT: 20,
        DELIVERY_CAPACITY: 15,
        EXPECTED_PROFITABILITY: 15,
        PAYMENT_TERMS: 10,
        COMPETITION: 5,
        SCOPE_CLARITY: 10,
        STRATEGIC_VALUE: 5,
      },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'BidScoringWeight' }),
    );
  });
});
