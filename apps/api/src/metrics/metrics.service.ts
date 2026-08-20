import { Injectable } from '@nestjs/common';
import {
  METRIC_DEFINITIONS,
  PENDING_ERP_METRICS,
  computeMetrics,
  dashboardFor,
  type MetricCode,
  type MetricInputs,
} from '@acms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { DataScopeService } from '../auth/data-scope.service';
import type { AuthenticatedUser } from '../auth/auth.types';

@Injectable()
export class MetricsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: DataScopeService,
  ) {}

  /**
   * The caller's dashboard.
   *
   * Everything runs through the same data-scope filter as the rest of the
   * system, so a business-unit manager's pipeline is their unit's and not the
   * group's. A metrics endpoint that ignored scope would be the most efficient
   * data leak in the product: one call returning the shape of the whole
   * company's book to anyone who asked.
   */
  async dashboard(user: AuthenticatedUser, asOf = new Date()) {
    const codes = dashboardFor(user.roles.map((r) => r.role as string));
    const inputs = await this.gather(user, asOf);
    const values = computeMetrics(codes, inputs);

    return {
      asOf,
      // The definition traveIs with the number. A reader who disagrees with a
      // figure can see the formula that produced it instead of guessing.
      metrics: values.map((v) => ({ ...v, definition: METRIC_DEFINITIONS[v.code] })),
      // Named rather than omitted: a board member should be told the screen is
      // not the whole picture, not left to assume it is.
      pendingErpIntegration: PENDING_ERP_METRICS,
      scope: {
        opportunities: inputs.opportunities.length,
        approvedCostings: inputs.approvedCostings?.length ?? 0,
      },
    };
  }

  /**
   * A report: any set of metrics the reader chose, over the same facts.
   *
   * One gather for the whole selection rather than one per metric — the reason
   * the dashboard is a single call applies with more force here, where a reader
   * can pick fourteen at once.
   *
   * Codes the reader is not entitled to are dropped rather than refused. The
   * alternative is a report that fails as a whole because one line was out of
   * reach, which teaches people to ask for less than they need; what they get
   * back names what was left out.
   */
  async report(user: AuthenticatedUser, codes: MetricCode[], asOf = new Date()) {
    const allowed = new Set(dashboardFor(user.roles.map((r) => r.role as string)));
    const requested = [...new Set(codes)];
    const permitted = requested.filter((c) => allowed.has(c));
    const withheld = requested.filter((c) => !allowed.has(c));

    const inputs = await this.gather(user, asOf);
    const values = computeMetrics(permitted, inputs);

    return {
      asOf,
      metrics: values.map((v) => ({ ...v, definition: METRIC_DEFINITIONS[v.code] })),
      // Named, so a reader knows the report is short rather than the number
      // being zero.
      withheld,
      scope: {
        opportunities: inputs.opportunities.length,
        approvedCostings: inputs.approvedCostings?.length ?? 0,
      },
    };
  }

  /** A single metric, for a screen that wants one number. */
  async metric(user: AuthenticatedUser, code: MetricCode, asOf = new Date()) {
    const inputs = await this.gather(user, asOf);
    const [value] = computeMetrics([code], inputs);
    return { ...value, definition: METRIC_DEFINITIONS[code] };
  }

  /**
   * Reads the facts once and computes every metric from them.
   *
   * One gather rather than one query per metric: eight metrics each fetching
   * the opportunity list would be eight identical scans, and worse, they could
   * disagree if a record changed between them.
   */
  private async gather(user: AuthenticatedUser, asOf: Date): Promise<MetricInputs> {
    const scopeFilter = await this.scope.buildFilter(user);
    const where = { deletedAt: null, ...scopeFilter };

    const opportunities = await this.prisma.opportunity.findMany({
      where,
      select: {
        id: true,
        accountId: true,
        status: true,
        currency: true,
        estimatedValue: true,
        probability: true,
        forecastCategory: true,
        health: true,
        createdAt: true,
        // Newest first so [0] is the current stage entry.
        stageHistory: { orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true } },
        activities: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { createdAt: true },
        },
        proposals: {
          where: { deletedAt: null },
          select: {
            versions: {
              where: { deletedAt: null, submittedAt: { not: null } },
              orderBy: { submittedAt: 'asc' },
              take: 1,
              select: { submittedAt: true },
            },
          },
        },
      },
    });

    const opportunityIds = opportunities.map((o) => o.id);

    const [costings, pendingApprovals, selectedQuotations] = await Promise.all([
      this.prisma.costingVersion.findMany({
        where: {
          status: 'APPROVED',
          deletedAt: null,
          scenario: { opportunityId: { in: opportunityIds } },
        },
        select: {
          totalCost: true,
          totalPrice: true,
          // The currency lives on the scenario, not the version.
          scenario: { select: { currency: true } },
        },
      }),
      this.prisma.approvalRequest.findMany({
        where: { status: 'PENDING', deletedAt: null, opportunityId: { in: opportunityIds } },
        select: { requestedAt: true },
      }),
      this.prisma.partnerQuotation.findMany({
        where: { isSelected: true, deletedAt: null, opportunityId: { in: opportunityIds } },
        select: { partnerId: true, totalValue: true },
      }),
    ]);

    return {
      asOf,
      opportunities: opportunities.map((o) => ({
        id: o.id,
        accountId: o.accountId,
        status: o.status,
        currency: o.currency,
        estimatedValue: o.estimatedValue === null ? null : Number(o.estimatedValue),
        // Stored as a whole percent; the metric works in 0..1.
        probability: o.probability === null ? null : o.probability / 100,
        forecastCategory: o.forecastCategory,
        health: o.health,
        stageEnteredAt: o.stageHistory[0]?.createdAt ?? null,
        lastActivityAt: o.activities[0]?.createdAt ?? null,
        createdAt: o.createdAt,
        firstProposalAt:
          o.proposals.flatMap((p) => p.versions).find((v) => v.submittedAt)?.submittedAt ?? null,
      })),
      approvedCostings: costings
        .filter((c) => c.totalPrice !== null && c.totalCost !== null)
        .map((c) => ({
          currency: c.scenario.currency,
          totalCost: Number(c.totalCost),
          totalPrice: Number(c.totalPrice),
        })),
      pendingApprovals,
      selectedQuotations: selectedQuotations.map((q) => ({
        partnerId: q.partnerId,
        value: Number(q.totalValue),
      })),
    };
  }
}
