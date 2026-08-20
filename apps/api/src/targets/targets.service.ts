import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  isMoneyMetric,
  periodElapsedPercent,
  progressFor,
  type SalesTarget,
  type TargetOpportunity,
} from '@acms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { DataScopeService } from '../auth/data-scope.service';
import { maySetTargets } from './target-authority';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { ListTargetsQuery, SetTargetDto } from './dto';

@Injectable()
export class TargetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: DataScopeService,
  ) {}

  /**
   * Targets the caller may see, each with what has actually been achieved.
   *
   * Progress is measured against the opportunities the caller can see, which
   * is the same rule the rest of the system runs on. A manager reading their
   * team's attainment and the salesperson reading their own see the same
   * number for that person, because both are computed from the same rows.
   */
  async list(user: AuthenticatedUser, query: ListTargetsQuery = {}) {
    const rows = await this.prisma.salesTarget.findMany({
      where: {
        deletedAt: null,
        ...(query.userId ? { userId: query.userId } : {}),
        ...(query.orgUnitId ? { orgUnitId: query.orgUnitId } : {}),
        ...(query.metric ? { metric: query.metric as never } : {}),
      },
      orderBy: [{ periodStart: 'desc' }, { createdAt: 'desc' }],
      include: {
        user: { select: { id: true, fullNameEn: true, fullNameAr: true } },
        orgUnit: { select: { id: true, code: true, nameEn: true } },
        createdBy: { select: { id: true, fullNameEn: true, fullNameAr: true } },
      },
    });

    const opportunities = await this.visibleOpportunities(user);
    const asOf = new Date();

    return {
      targets: rows.map((row) => {
        const target = this.toShared(row);
        const progress = progressFor(target, opportunities);

        return {
          ...row,
          value: Number(row.value),
          actual: progress.actual,
          attainmentPercent: progress.attainmentPercent,
          basis: progress.basis,
          unmeasurableReason: progress.unmeasurableReason ?? null,
          // Attainment alone cannot tell March from December. This is what
          // makes the percentage mean something.
          periodElapsedPercent: periodElapsedPercent(target.period, target.periodStart, asOf),
        };
      }),
      canEdit: maySetTargets(user.roles),
    };
  }

  /**
   * Who a target may be set for.
   *
   * Served from here rather than from /users, which is SYSTEM_ADMIN only: a
   * sales director may set targets and may not administer accounts, so reading
   * the roster through that route would hand them an empty dropdown for
   * exactly the task they are allowed to do.
   *
   * The people are those whose deals the caller can already see, so the list
   * never reveals a colleague outside their scope.
   */
  async assignable(user: AuthenticatedUser) {
    if (!maySetTargets(user.roles)) return { people: [], units: [] };

    const scopeFilter = await this.scope.buildFilter(user);
    const owners = await this.prisma.opportunity.findMany({
      where: { deletedAt: null, ...scopeFilter },
      select: { owner: { select: { id: true, fullNameEn: true, fullNameAr: true } } },
      distinct: ['ownerId'],
    });

    const units = await this.prisma.organizationUnit.findMany({
      where: { deletedAt: null },
      orderBy: { code: 'asc' },
      select: { id: true, code: true, nameEn: true },
    });

    return {
      people: owners
        .map((o) => o.owner)
        .filter((p): p is NonNullable<typeof p> => Boolean(p))
        .sort((a, b) => (a.fullNameEn ?? '').localeCompare(b.fullNameEn ?? '')),
      units,
    };
  }

  /**
   * Set a target.
   *
   * A new row supersedes the old one for the same owner, period and metric
   * rather than overwriting it — the treatment approval limits and resource
   * rates get, for the same reason. A quarter that has closed must stay
   * explainable against the number that applied while it was open, and a
   * target quietly raised in month three rewrites how month one read.
   */
  async set(user: AuthenticatedUser, dto: SetTargetDto) {
    if (!maySetTargets(user.roles)) {
      await this.audit.record({
        entityType: 'SalesTarget',
        entityId: dto.userId ?? dto.orgUnitId ?? 'unknown',
        action: 'SOD_BLOCKED',
        userId: user.id,
        after: { attemptedAction: 'TARGET_SET', metric: dto.metric },
      });
      throw new ForbiddenException(
        'Targets are not set by the people measured against them',
      );
    }

    this.assertSensible(dto);

    const periodStart = new Date(dto.periodStart);
    const previous = await this.prisma.salesTarget.findFirst({
      where: {
        deletedAt: null,
        userId: dto.userId ?? null,
        orgUnitId: dto.orgUnitId ?? null,
        metric: dto.metric as never,
        period: dto.period as never,
        periodStart,
      },
      orderBy: { createdAt: 'desc' },
    });

    const created = await this.prisma.salesTarget.create({
      data: {
        userId: dto.userId,
        orgUnitId: dto.orgUnitId,
        period: dto.period as never,
        periodStart,
        metric: dto.metric as never,
        currency: isMoneyMetric(dto.metric as never) ? dto.currency : null,
        value: dto.value,
        note: dto.note,
        createdById: user.id,
      },
    });

    if (previous) {
      await this.prisma.salesTarget.update({
        where: { id: previous.id },
        data: { deletedAt: new Date() },
      });
    }

    await this.audit.record({
      entityType: 'SalesTarget',
      entityId: created.id,
      action: previous ? 'UPDATE' : 'CREATE',
      userId: user.id,
      before: previous ? { value: Number(previous.value) } : undefined,
      after: {
        owner: dto.userId ?? dto.orgUnitId,
        metric: dto.metric,
        period: dto.period,
        value: dto.value,
        currency: created.currency,
      },
    });

    return created;
  }

  async remove(user: AuthenticatedUser, id: string) {
    if (!maySetTargets(user.roles)) {
      throw new ForbiddenException('Targets are not set by the people measured against them');
    }

    const target = await this.prisma.salesTarget.findFirst({ where: { id, deletedAt: null } });
    if (!target) throw new NotFoundException('Target not found');

    await this.prisma.salesTarget.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.record({
      entityType: 'SalesTarget',
      entityId: id,
      action: 'SOFT_DELETE',
      userId: user.id,
      before: { metric: target.metric, value: Number(target.value) },
    });

    return { success: true };
  }

  // -------------------------------------------------------------------------

  /** The rows progress is measured against — the caller's own visibility. */
  private async visibleOpportunities(user: AuthenticatedUser): Promise<TargetOpportunity[]> {
    const scopeFilter = await this.scope.buildFilter(user);
    const rows = await this.prisma.opportunity.findMany({
      where: { deletedAt: null, ...scopeFilter },
      select: {
        ownerId: true,
        orgUnitId: true,
        status: true,
        currency: true,
        estimatedValue: true,
        // A win is dated by when it left the funnel, not by when it was made.
        exitedAt: true,
        updatedAt: true,
      },
    });

    return rows.map((o) => ({
      ownerId: o.ownerId,
      orgUnitId: o.orgUnitId,
      status: o.status,
      currency: o.currency,
      estimatedValue: o.estimatedValue === null ? null : Number(o.estimatedValue),
      // Falls back to updatedAt only for a closed deal that never recorded an
      // exit date, so an old row still lands in some period rather than none.
      closedAt: o.exitedAt ?? (o.status === 'CLOSED' ? o.updatedAt : null),
    }));
  }

  private toShared(row: {
    id: string;
    userId: string | null;
    orgUnitId: string | null;
    period: string;
    periodStart: Date;
    metric: string;
    currency: string | null;
    value: unknown;
  }): SalesTarget {
    return {
      id: row.id,
      userId: row.userId,
      orgUnitId: row.orgUnitId,
      period: row.period as SalesTarget['period'],
      periodStart: row.periodStart,
      metric: row.metric as SalesTarget['metric'],
      currency: row.currency,
      value: Number(row.value),
    };
  }

  private assertSensible(dto: SetTargetDto) {
    // Exactly one owner. A row naming both would be counted twice the moment
    // anybody rolled the numbers up.
    if (Boolean(dto.userId) === Boolean(dto.orgUnitId)) {
      throw new BadRequestException('A target belongs to a person or to a unit, not both');
    }
    if (dto.value <= 0) {
      throw new BadRequestException('A target of zero is a target nobody can be measured against');
    }
    if (isMoneyMetric(dto.metric as never) && !dto.currency) {
      throw new BadRequestException(`${dto.metric} is money and needs a currency`);
    }
  }
}
