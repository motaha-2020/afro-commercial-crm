import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CodeGeneratorService } from '../common/code-generator.service';
import { OpportunityAccessService } from '../common/opportunity-access.service';
import { DataScopeService } from '../auth/data-scope.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type {
  CreateBidDto,
  CreateRequirementDto,
  UpdateBidDto,
  UpdateRequirementDto,
} from './dto';

@Injectable()
export class BidsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly codes: CodeGeneratorService,
    private readonly access: OpportunityAccessService,
    private readonly scope: DataScopeService,
    private readonly notifications: NotificationsService,
  ) {}

  async listForOpportunity(user: AuthenticatedUser, opportunityId: string) {
    await this.access.assert(user, opportunityId);

    const bids = await this.prisma.bid.findMany({
      where: { opportunityId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        requirements: {
          where: { deletedAt: null },
          orderBy: [{ mandatory: 'desc' }, { dueDate: 'asc' }],
          include: { owner: { select: { id: true, fullNameEn: true, fullNameAr: true } } },
        },
      },
    });

    return bids.map((bid) => ({ ...bid, checklist: this.checklist(bid.requirements) }));
  }

  /**
   * A tender is not lost on price nearly as often as it is lost on a missing
   * certificate, so the checklist reports mandatory completion separately —
   * "8 of 10 done" hides the two that disqualify you.
   */
  private checklist(requirements: { mandatory: boolean; status: string }[]) {
    const done = new Set(['READY', 'SUBMITTED', 'WAIVED']);
    const mandatory = requirements.filter((r) => r.mandatory);
    return {
      total: requirements.length,
      complete: requirements.filter((r) => done.has(r.status)).length,
      mandatoryTotal: mandatory.length,
      mandatoryComplete: mandatory.filter((r) => done.has(r.status)).length,
      mandatoryOutstanding: mandatory.filter((r) => !done.has(r.status)).length,
    };
  }

  async create(user: AuthenticatedUser, opportunityId: string, dto: CreateBidDto) {
    await this.access.assert(user, opportunityId);

    if (dto.submissionDeadline && dto.clarificationDeadline) {
      // Questions must close before the bid is due; the reverse is a data entry
      // slip that quietly kills the chance to ask anything.
      if (new Date(dto.clarificationDeadline) > new Date(dto.submissionDeadline)) {
        throw new BadRequestException(
          'The clarification deadline must fall on or before the submission deadline',
        );
      }
    }
    if (dto.bidBondRequired && dto.bidBondAmount === undefined) {
      throw new BadRequestException('A required bid bond needs an amount');
    }

    const code = await this.codes.next('BID', 'bid', new Date().getFullYear());
    const bid = await this.prisma.bid.create({
      data: {
        code,
        opportunityId,
        type: dto.type,
        tenderNumber: dto.tenderNumber,
        issueDate: dto.issueDate ? new Date(dto.issueDate) : undefined,
        submissionDeadline: dto.submissionDeadline ? new Date(dto.submissionDeadline) : undefined,
        clarificationDeadline: dto.clarificationDeadline
          ? new Date(dto.clarificationDeadline)
          : undefined,
        bidBondRequired: dto.bidBondRequired ?? false,
        bidBondAmount: dto.bidBondAmount,
        bidBondCurrency: dto.bidBondCurrency,
        submissionMethod: dto.submissionMethod,
        portalReference: dto.portalReference,
        notes: dto.notes,
      },
    });

    await this.audit.record({
      entityType: 'Bid',
      entityId: bid.id,
      action: 'CREATE',
      userId: user.id,
      after: { code: bid.code, type: bid.type, tenderNumber: bid.tenderNumber },
    });

    return bid;
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateBidDto) {
    const existing = await this.bidOr404(user, id);

    const data: Prisma.BidUpdateInput = {
      ...dto,
      issueDate: dto.issueDate ? new Date(dto.issueDate) : undefined,
      submissionDeadline: dto.submissionDeadline ? new Date(dto.submissionDeadline) : undefined,
      clarificationDeadline: dto.clarificationDeadline
        ? new Date(dto.clarificationDeadline)
        : undefined,
      submittedAt: dto.submittedAt ? new Date(dto.submittedAt) : undefined,
    };

    if (dto.status === 'SUBMITTED') {
      const outstanding = await this.prisma.bidRequirement.count({
        where: { bidId: id, deletedAt: null, mandatory: true, status: { in: ['NOT_STARTED', 'IN_PROGRESS'] } },
      });
      // Blocking would be wrong — a deadline sometimes forces an incomplete
      // submission — but it must be a deliberate act, recorded as such.
      if (outstanding > 0) {
        await this.audit.record({
          entityType: 'Bid',
          entityId: id,
          action: 'UPDATE',
          userId: user.id,
          after: { submittedWithOutstandingMandatoryRequirements: outstanding },
        });
      }
      if (!dto.submittedAt && !existing.submittedAt) data.submittedAt = new Date();
    }

    const updated = await this.prisma.bid.update({ where: { id }, data });

    await this.audit.recordUpdate(
      'Bid',
      id,
      existing as unknown as Record<string, unknown>,
      updated as unknown as Record<string, unknown>,
      user.id,
    );

    if (dto.status && dto.status !== existing.status) {
      await this.notifications.dispatchEvent('BID_STATUS_CHANGED', {
        title: `${updated.code}: ${existing.status} → ${updated.status}`,
        body: updated.tenderNumber ?? undefined,
        entityType: 'Bid',
        entityId: id,
      });
    }

    return updated;
  }

  async remove(user: AuthenticatedUser, id: string) {
    const existing = await this.bidOr404(user, id);
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.bidRequirement.updateMany({
        where: { bidId: id, deletedAt: null },
        data: { deletedAt: now },
      }),
      this.prisma.bid.update({ where: { id }, data: { deletedAt: now } }),
    ]);
    await this.audit.record({
      entityType: 'Bid',
      entityId: id,
      action: 'SOFT_DELETE',
      userId: user.id,
      before: { code: existing.code },
    });
    return { success: true };
  }

  // --- checklist ------------------------------------------------------------

  async addRequirement(user: AuthenticatedUser, bidId: string, dto: CreateRequirementDto) {
    await this.bidOr404(user, bidId);

    const requirement = await this.prisma.bidRequirement.create({
      data: {
        ...dto,
        bidId,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
      },
    });
    await this.audit.record({
      entityType: 'BidRequirement',
      entityId: requirement.id,
      action: 'CREATE',
      userId: user.id,
      after: { description: requirement.description, mandatory: requirement.mandatory },
    });
    return requirement;
  }

  async updateRequirement(user: AuthenticatedUser, id: string, dto: UpdateRequirementDto) {
    const existing = await this.requirementOr404(user, id);

    const updated = await this.prisma.bidRequirement.update({
      where: { id },
      data: { ...dto, dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined },
    });
    await this.audit.recordUpdate(
      'BidRequirement',
      id,
      existing as unknown as Record<string, unknown>,
      updated as unknown as Record<string, unknown>,
      user.id,
    );
    return updated;
  }

  async removeRequirement(user: AuthenticatedUser, id: string) {
    await this.requirementOr404(user, id);
    await this.prisma.bidRequirement.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.record({
      entityType: 'BidRequirement',
      entityId: id,
      action: 'SOFT_DELETE',
      userId: user.id,
    });
    return { success: true };
  }

  /**
   * Deadlines the caller can actually see, soonest first. A submission date is
   * the one commercial fact that cannot be recovered once missed, so it gets a
   * dedicated view rather than living inside each opportunity.
   */
  async upcomingDeadlines(user: AuthenticatedUser, days = 30) {
    const filter = await this.scope.buildFilter(user);
    const until = new Date(Date.now() + days * 86_400_000);

    const bids = await this.prisma.bid.findMany({
      where: {
        deletedAt: null,
        status: { in: ['IDENTIFIED', 'PREPARING', 'CLARIFICATION'] },
        submissionDeadline: { not: null, lte: until },
        opportunity: { deletedAt: null, ...filter },
      },
      orderBy: { submissionDeadline: 'asc' },
      include: {
        opportunity: { select: { id: true, code: true, name: true } },
        requirements: { where: { deletedAt: null }, select: { mandatory: true, status: true } },
      },
    });

    return bids.map((bid) => ({
      ...bid,
      checklist: this.checklist(bid.requirements),
      daysRemaining: bid.submissionDeadline
        ? Math.ceil((bid.submissionDeadline.getTime() - Date.now()) / 86_400_000)
        : null,
    }));
  }

  // --- gates ----------------------------------------------------------------

  private async bidOr404(user: AuthenticatedUser, id: string) {
    const bid = await this.prisma.bid.findFirst({ where: { id, deletedAt: null } });
    if (!bid) throw new NotFoundException('Bid not found');
    await this.access.assertVia(user, bid.opportunityId);
    return bid;
  }

  private async requirementOr404(user: AuthenticatedUser, id: string) {
    const row = await this.prisma.bidRequirement.findFirst({
      where: { id, deletedAt: null },
      include: { bid: { select: { opportunityId: true } } },
    });
    if (!row) throw new NotFoundException('Requirement not found');
    await this.access.assertVia(user, row.bid.opportunityId);
    return row;
  }
}
