import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import {
  BID_RATING_MAX,
  BID_RATING_MIN,
  BID_SCORE_FACTORS,
  BID_SCORE_FACTOR_DEFINITIONS,
  bidScore,
  defaultWeights,
  suggestDecision,
  unratedFactors,
  validateWeights,
  type BidScoreFactor,
} from '@acms/shared';
import type { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OpportunityAccessService } from '../common/opportunity-access.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { AssessBidDto, RecordDecisionDto, UpdateWeightsDto } from './dto';

/**
 * The spec restricts weight changes to "Admin أو Commercial Management" — the
 * weights decide which pursuits the company walks away from, so tuning them is
 * a governance act, not a preference.
 */
const WEIGHT_AUTHORITY: Role[] = ['SYSTEM_ADMIN', 'CEO', 'OWNER_BOARD', 'SALES_DIRECTOR'];

@Injectable()
export class AssessmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OpportunityAccessService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Configured weights, falling back to the spec's indicative split. */
  async currentWeights(): Promise<Record<string, number>> {
    const rows = await this.prisma.bidScoringWeight.findMany();
    if (rows.length === 0) return defaultWeights();

    const configured = Object.fromEntries(rows.map((r) => [r.factor, r.weight]));
    // A partial row set would silently score out of less than 100; fill the
    // gaps from the defaults rather than quietly shrinking the scale.
    return { ...defaultWeights(), ...configured };
  }

  async weightsView() {
    const weights = await this.currentWeights();
    return {
      factors: BID_SCORE_FACTOR_DEFINITIONS.map((f) => ({
        ...f,
        weight: weights[f.code] ?? f.defaultWeight,
      })),
      total: Object.values(weights).reduce((a, b) => a + b, 0),
      ratingScale: { min: BID_RATING_MIN, max: BID_RATING_MAX },
    };
  }

  async updateWeights(user: AuthenticatedUser, dto: UpdateWeightsDto) {
    if (!user.roles.some((r) => WEIGHT_AUTHORITY.includes(r.role))) {
      throw new ForbiddenException(
        'Only system administration or commercial management may change scoring weights',
      );
    }

    const issues = validateWeights(dto.weights);
    if (issues.length > 0) {
      throw new BadRequestException({ message: 'Invalid scoring weights', issues });
    }

    const before = await this.currentWeights();
    await this.prisma.$transaction(
      Object.entries(dto.weights).map(([factor, weight]) =>
        this.prisma.bidScoringWeight.upsert({
          where: { factor },
          create: { factor, weight, updatedById: user.id },
          update: { weight, updatedById: user.id },
        }),
      ),
    );

    await this.audit.record({
      entityType: 'BidScoringWeight',
      entityId: 'GLOBAL',
      action: 'UPDATE',
      userId: user.id,
      before: before as Prisma.InputJsonValue,
      after: dto.weights as Prisma.InputJsonValue,
    });

    return this.weightsView();
  }

  async history(user: AuthenticatedUser, opportunityId: string) {
    await this.access.assert(user, opportunityId);

    const assessments = await this.prisma.bidAssessment.findMany({
      where: { opportunityId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        assessedBy: { select: { id: true, fullNameEn: true, fullNameAr: true } },
        decidedBy: { select: { id: true, fullNameEn: true, fullNameAr: true } },
      },
    });

    return {
      latest: assessments[0] ?? null,
      history: assessments,
      weights: await this.weightsView(),
    };
  }

  /**
   * Scores an opportunity and writes the total back onto it, because the stage
   * gate out of OPPORTUNITY_QUALIFICATION asks for `bidNoBidScore`. Each run is
   * a new record: re-assessing after new information must not erase the
   * judgement made before it.
   */
  async assess(user: AuthenticatedUser, opportunityId: string, dto: AssessBidDto) {
    await this.access.assert(user, opportunityId);

    const known = new Set<string>(BID_SCORE_FACTORS);
    const ratings: Partial<Record<BidScoreFactor, number>> = {};

    for (const [factor, rating] of Object.entries(dto.ratings)) {
      if (!known.has(factor)) {
        throw new BadRequestException(`Unknown scoring factor: ${factor}`);
      }
      if (typeof rating !== 'number' || Number.isNaN(rating)) {
        throw new BadRequestException(`Rating for ${factor} must be a number`);
      }
      if (rating < BID_RATING_MIN || rating > BID_RATING_MAX) {
        throw new BadRequestException(
          `Rating for ${factor} must be between ${BID_RATING_MIN} and ${BID_RATING_MAX}`,
        );
      }
      ratings[factor as BidScoreFactor] = rating;
    }

    const weights = await this.currentWeights();
    const score = bidScore(ratings, weights);
    const suggested = suggestDecision(score);

    const assessment = await this.prisma.bidAssessment.create({
      data: {
        opportunityId,
        ratings: ratings as Prisma.InputJsonValue,
        // The weights in force are stored with the score so a historical
        // assessment stays reproducible after someone re-tunes them.
        weights: weights as Prisma.InputJsonValue,
        score,
        suggestedDecision: suggested,
        assessedById: user.id,
      },
    });

    await this.prisma.opportunity.update({
      where: { id: opportunityId },
      data: { bidNoBidScore: Math.round(score) },
    });

    await this.audit.record({
      entityType: 'BidAssessment',
      entityId: assessment.id,
      action: 'CREATE',
      userId: user.id,
      after: { opportunityId, score, suggestedDecision: suggested },
    });

    return {
      ...assessment,
      unrated: unratedFactors(ratings),
      /** Never applied automatically — a person records the decision. */
      suggestedDecision: suggested,
    };
  }

  /**
   * Records the human decision. Departing from the suggestion is allowed and
   * expected — the spec is clear that No Bid is a legitimate outcome and that
   * the weights are indicative — but a departure must carry a reason, so the
   * override is answerable later rather than invisible.
   */
  async decide(user: AuthenticatedUser, assessmentId: string, dto: RecordDecisionDto) {
    const assessment = await this.prisma.bidAssessment.findFirst({
      where: { id: assessmentId, deletedAt: null },
    });
    if (!assessment) throw new BadRequestException('Assessment not found');
    const opportunity = await this.access.assertVia(user, assessment.opportunityId);

    if (dto.decision !== assessment.suggestedDecision && !dto.rationale) {
      throw new BadRequestException({
        message: `Decision "${dto.decision}" differs from the suggested "${assessment.suggestedDecision}" — a rationale is required`,
        suggestedDecision: assessment.suggestedDecision,
      });
    }

    const updated = await this.prisma.bidAssessment.update({
      where: { id: assessmentId },
      data: {
        decision: dto.decision,
        decisionRationale: dto.rationale,
        decidedById: user.id,
        decidedAt: new Date(),
      },
    });

    await this.prisma.opportunity.update({
      where: { id: assessment.opportunityId },
      data: { bidDecision: dto.decision },
    });

    await this.audit.record({
      entityType: 'BidAssessment',
      entityId: assessmentId,
      action: 'UPDATE',
      userId: user.id,
      before: { decision: assessment.decision },
      after: {
        decision: dto.decision,
        suggestedDecision: assessment.suggestedDecision,
        overrode: dto.decision !== assessment.suggestedDecision,
        rationale: dto.rationale,
      },
    });

    await this.notifications.dispatchEvent('BID_DECISION_RECORDED', {
      title: `${opportunity.code}: ${dto.decision}`,
      body: dto.rationale ?? `Score ${assessment.score}`,
      entityType: 'Opportunity',
      entityId: assessment.opportunityId,
    });

    return updated;
  }
}
