import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Opportunity, Prisma } from '@prisma/client';
import {
  STAGE_EXIT_REQUIREMENTS,
  STAGE_ORDER,
  marginPercent,
  type OpportunityStage,
} from '@acms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CodeGeneratorService } from '../common/code-generator.service';
import { DataScopeService } from '../auth/data-scope.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type {
  ChangeStageDto,
  ChangeStatusDto,
  CreateOpportunityDto,
  ListOpportunitiesQuery,
  UpdateOpportunityDto,
} from './dto';

const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  'CANCELLED',
  'LOST',
  'CLOSED',
]);

@Injectable()
export class OpportunitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly codes: CodeGeneratorService,
    private readonly scope: DataScopeService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(user: AuthenticatedUser, query: ListOpportunitiesQuery) {
    const scopeFilter = await this.scope.buildFilter(user);

    const where: Prisma.OpportunityWhereInput = {
      deletedAt: null,
      ...scopeFilter,
      ...(query.stage ? { stage: query.stage } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.country ? { country: query.country } : {}),
      ...(query.accountId ? { accountId: query.accountId } : {}),
      ...(query.health ? { health: query.health } : {}),
      ...(query.ownerId ? { ownerId: query.ownerId } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { code: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const items = await this.prisma.opportunity.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: {
        account: { select: { id: true, code: true, legalName: true } },
        owner: { select: { id: true, fullNameEn: true, fullNameAr: true } },
      },
    });

    return { items, total: items.length };
  }

  /**
   * The owners a filter may legitimately offer.
   *
   * Derived from the unfiltered scope rather than from the rows on screen: an
   * owner dropdown built out of the current results would lose every other
   * owner the moment one was picked, and there would be no way back.
   */
  async owners(user: AuthenticatedUser) {
    const scopeFilter = await this.scope.buildFilter(user);

    const rows = await this.prisma.opportunity.findMany({
      where: { deletedAt: null, ...scopeFilter },
      distinct: ['ownerId'],
      select: {
        owner: { select: { id: true, fullNameEn: true, fullNameAr: true } },
      },
    });

    return rows
      .map((r) => r.owner)
      .sort((a, b) => a.fullNameEn.localeCompare(b.fullNameEn));
  }

  async findOne(user: AuthenticatedUser, id: string) {
    const scopeFilter = await this.scope.buildFilter(user);

    const opp = await this.prisma.opportunity.findFirst({
      where: { id, deletedAt: null, ...scopeFilter },
      include: {
        account: { select: { id: true, code: true, legalName: true, country: true } },
        owner: { select: { id: true, fullNameEn: true, fullNameAr: true } },
        primaryContact: true,
        stageHistory: {
          orderBy: { createdAt: 'asc' },
          include: {
            changedBy: { select: { id: true, fullNameEn: true, fullNameAr: true } },
          },
        },
        team: {
          where: { deletedAt: null },
          include: {
            user: { select: { id: true, fullNameEn: true, fullNameAr: true } },
          },
        },
      },
    });

    if (!opp) throw new NotFoundException('Opportunity not found');
    return opp;
  }

  async create(user: AuthenticatedUser, dto: CreateOpportunityDto) {
    const account = await this.prisma.account.findFirst({
      where: { id: dto.accountId, deletedAt: null },
      select: { id: true },
    });
    if (!account) throw new NotFoundException('Account not found');

    const year = new Date().getFullYear();
    const code = await this.codes.next('OPP', 'opportunity', year);

    const opp = await this.prisma.opportunity.create({
      data: {
        code,
        name: dto.name,
        accountId: dto.accountId,
        country: dto.country,
        industry: dto.industry,
        source: dto.source,
        currency: dto.currency ?? 'USD',
        estimatedValue: dto.estimatedValue,
        primaryContactId: dto.primaryContactId,
        ownerId: dto.ownerId ?? user.id,
        orgUnitId: user.orgUnitId,
        nextStep: dto.nextStep,
        // Every opportunity starts at intake, active, pipeline, green — the
        // four readings are independent from the first row.
        stage: 'LEAD_INTAKE',
        status: 'ACTIVE',
        forecastCategory: 'PIPELINE',
        health: 'GREEN',
      },
    });

    await this.prisma.opportunityStageHistory.create({
      data: {
        opportunityId: opp.id,
        fromStage: null,
        toStage: 'LEAD_INTAKE',
        changedById: user.id,
        reason: 'Created',
      },
    });

    await this.audit.record({
      entityType: 'Opportunity',
      entityId: opp.id,
      action: 'CREATE',
      userId: user.id,
      after: { code: opp.code, name: opp.name },
    });

    return opp;
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateOpportunityDto) {
    const existing = await this.findOne(user, id);

    const data: Prisma.OpportunityUpdateInput = {
      ...dto,
      expectedCloseDate: dto.expectedCloseDate
        ? new Date(dto.expectedCloseDate)
        : undefined,
      submissionDate: dto.submissionDate
        ? new Date(dto.submissionDate)
        : undefined,
    };

    // Keep margin consistent whenever both sides of it are known. Margin is over
    // selling price, never cost — see @acms/shared.
    const cost = dto.estimatedCost ?? Number(existing.estimatedCost ?? 0);
    const price = dto.proposedPrice ?? Number(existing.proposedPrice ?? 0);
    if (cost > 0 && price > 0) {
      data.marginPercent = Number(marginPercent(cost, price).toFixed(2));
    }

    const updated = await this.prisma.opportunity.update({ where: { id }, data });

    await this.audit.recordUpdate(
      'Opportunity',
      id,
      existing as unknown as Record<string, unknown>,
      updated as unknown as Record<string, unknown>,
      user.id,
    );

    return updated;
  }

  /**
   * Progressive Data Capture lives here: an opportunity may only LEAVE a stage
   * once that stage's required fields are populated. Advancing therefore checks
   * the requirements of every stage from the current one up to (but excluding)
   * the target, so jumping two stages cannot skip an obligation.
   */
  async changeStage(user: AuthenticatedUser, id: string, dto: ChangeStageDto) {
    const opp = await this.findOne(user, id);

    if (TERMINAL_STATUSES.has(opp.status)) {
      throw new BadRequestException(
        `A ${opp.status} opportunity cannot change stage`,
      );
    }
    if (opp.stage === dto.toStage) {
      throw new BadRequestException('Opportunity is already at that stage');
    }

    const fromRank = STAGE_ORDER[opp.stage as OpportunityStage];
    const toRank = STAGE_ORDER[dto.toStage as OpportunityStage];

    if (toRank > fromRank) {
      const missing = this.collectMissingFields(opp, opp.stage as OpportunityStage, dto.toStage as OpportunityStage);
      if (missing.length > 0) {
        throw new BadRequestException({
          message: 'Required fields are missing to advance to this stage',
          missingFields: missing,
        });
      }
    }

    const now = new Date();
    const lastEntry = await this.prisma.opportunityStageHistory.findFirst({
      where: { opportunityId: id },
      orderBy: { createdAt: 'desc' },
    });
    const durationHours = lastEntry
      ? Math.round((now.getTime() - lastEntry.createdAt.getTime()) / 3_600_000)
      : null;

    const [updated] = await this.prisma.$transaction([
      this.prisma.opportunity.update({
        where: { id },
        data: { stage: dto.toStage },
      }),
      this.prisma.opportunityStageHistory.create({
        data: {
          opportunityId: id,
          fromStage: opp.stage,
          toStage: dto.toStage,
          changedById: user.id,
          reason: dto.reason,
          durationHours,
        },
      }),
    ]);

    await this.audit.record({
      entityType: 'Opportunity',
      entityId: id,
      action: 'STAGE_CHANGE',
      userId: user.id,
      before: { stage: opp.stage },
      after: { stage: dto.toStage },
    });

    // Let governance-defined rules decide who hears about a stage change. No
    // rule configured → no notifications, silently.
    await this.notifications.dispatchEvent('OPPORTUNITY_STAGE_CHANGED', {
      title: `${opp.code} moved to ${dto.toStage}`,
      body: opp.name,
      entityType: 'Opportunity',
      entityId: id,
    });

    return updated;
  }

  async changeStatus(user: AuthenticatedUser, id: string, dto: ChangeStatusDto) {
    const opp = await this.findOne(user, id);

    const goingTerminal = TERMINAL_STATUSES.has(dto.status);
    if (goingTerminal && dto.status !== 'CLOSED' && !dto.exitReason) {
      throw new BadRequestException(
        'An exit reason is required when cancelling or marking an opportunity lost',
      );
    }

    const updated = await this.prisma.opportunity.update({
      where: { id },
      data: {
        status: dto.status,
        exitReason: goingTerminal ? dto.exitReason : null,
        exitNotes: goingTerminal ? dto.exitNotes : null,
        exitedAt: goingTerminal ? new Date() : null,
        forecastCategory: dto.status === 'CLOSED' ? 'CLOSED_WON' : opp.forecastCategory,
      },
    });

    await this.audit.record({
      entityType: 'Opportunity',
      entityId: id,
      action: 'STATUS_CHANGE',
      userId: user.id,
      before: { status: opp.status },
      after: { status: dto.status, exitReason: dto.exitReason },
    });

    return updated;
  }

  async remove(user: AuthenticatedUser, id: string) {
    const opp = await this.findOne(user, id);
    await this.prisma.opportunity.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.audit.record({
      entityType: 'Opportunity',
      entityId: id,
      action: 'SOFT_DELETE',
      userId: user.id,
      before: { code: opp.code, name: opp.name },
    });
    return { success: true };
  }

  private collectMissingFields(
    opp: Opportunity,
    from: OpportunityStage,
    to: OpportunityStage,
  ): string[] {
    const record = opp as unknown as Record<string, unknown>;
    const missing = new Set<string>();

    for (const stage of Object.keys(STAGE_ORDER) as OpportunityStage[]) {
      const rank = STAGE_ORDER[stage];
      if (rank < STAGE_ORDER[from] || rank >= STAGE_ORDER[to]) continue;
      for (const field of STAGE_EXIT_REQUIREMENTS[stage]) {
        const value = record[field];
        if (value === null || value === undefined || value === '') {
          missing.add(field);
        }
      }
    }

    return [...missing];
  }
}
