import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  HANDOVER_CATEGORIES,
  REQUIRED_HANDOVER_PARTIES,
  handoverReadiness,
  isBinding,
  scopeReadiness,
  signoffProgress,
  strongerAward,
  type AwardType,
  type HandoverParty,
} from '@acms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CodeGeneratorService } from '../common/code-generator.service';
import { OpportunityAccessService } from '../common/opportunity-access.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type {
  AddHandoverItemDto,
  CreateHandoverDto,
  SignoffDto,
  UpdateHandoverDto,
  UpdateHandoverItemDto,
} from './dto';

/**
 * The pack the spec asks for, as a starting checklist. Seeded on creation so a
 * handover begins as a list of what is owed rather than an empty page somebody
 * has to remember to fill.
 */
const DEFAULT_ITEMS: { category: (typeof HANDOVER_CATEGORIES)[number]; name: string }[] = [
  { category: 'CONTRACT', name: 'Signed contract or purchase order' },
  { category: 'BOQ', name: 'Final BOQ' },
  { category: 'COST_BASELINE', name: 'Approved cost baseline' },
  { category: 'SCOPE', name: 'Scope of work' },
  { category: 'ASSUMPTIONS', name: 'Assumptions register' },
  { category: 'EXCLUSIONS', name: 'Exclusions' },
  { category: 'RISKS', name: 'Risk register' },
  { category: 'PAYMENT', name: 'Payment plan and terms' },
  { category: 'SUPPLIERS', name: 'Selected suppliers and prices' },
  { category: 'SUBCONTRACTORS', name: 'Selected subcontractors and prices' },
  { category: 'SCHEDULE', name: 'Delivery schedule' },
  { category: 'CUSTOMER_CONTACTS', name: 'Customer contacts' },
];

@Injectable()
export class HandoverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly codes: CodeGeneratorService,
    private readonly opportunities: OpportunityAccessService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(user: AuthenticatedUser, opportunityId: string) {
    await this.opportunities.assert(user, opportunityId);
    return this.prisma.projectHandover.findMany({
      where: { opportunityId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        projectManager: { select: { id: true, fullNameEn: true, fullNameAr: true } },
        _count: { select: { items: true } },
      },
    });
  }

  async create(user: AuthenticatedUser, opportunityId: string, dto: CreateHandoverDto) {
    await this.opportunities.assert(user, opportunityId);

    const existing = await this.prisma.projectHandover.findFirst({
      where: { opportunityId, deletedAt: null, status: { not: 'REJECTED' } },
    });
    if (existing) {
      throw new BadRequestException('A handover already exists for this opportunity');
    }

    const handover = await this.prisma.projectHandover.create({
      data: {
        code: await this.codes.next('HND', 'handover', new Date().getFullYear()),
        opportunityId,
        contractId: dto.contractId,
        costBaselineVersionId: dto.costBaselineVersionId,
        projectManagerId: dto.projectManagerId,
        plannedStartDate: dto.plannedStartDate ? new Date(dto.plannedStartDate) : null,
        createdById: user.id,
        items: { create: DEFAULT_ITEMS.map((i) => ({ ...i })) },
        // One row per required party, created empty. An absent row and an
        // unanswered one look the same to a reader; a row that exists and is
        // blank says "this person has not answered yet".
        signoffs: { create: REQUIRED_HANDOVER_PARTIES.map((party) => ({ party })) },
      },
    });

    await this.audit.record({
      entityType: 'ProjectHandover',
      entityId: handover.id,
      action: 'CREATE',
      userId: user.id,
      after: { opportunityId, contractId: dto.contractId ?? null },
    });

    return this.findOne(user, handover.id);
  }

  /**
   * The handover with its readiness verdict.
   *
   * Readiness is computed on read rather than stored, because every input can
   * change underneath it — a costing can be superseded, a deviation reopened.
   * A stored "ready" flag would go stale silently and let a project through on
   * conditions that no longer hold.
   */
  async findOne(user: AuthenticatedUser, id: string) {
    const handover = await this.prisma.projectHandover.findFirst({
      where: { id, deletedAt: null },
      include: {
        contract: {
          include: { deviations: { where: { deletedAt: null } } },
        },
        costBaselineVersion: { select: { id: true, versionNumber: true, status: true } },
        projectManager: { select: { id: true, fullNameEn: true, fullNameAr: true } },
        items: {
          where: { deletedAt: null },
          orderBy: { category: 'asc' },
          include: { responsible: { select: { id: true, fullNameEn: true, fullNameAr: true } } },
        },
        signoffs: {
          where: { deletedAt: null },
          include: { signedBy: { select: { id: true, fullNameEn: true, fullNameAr: true } } },
        },
      },
    });
    if (!handover) throw new NotFoundException('Handover not found');
    await this.opportunities.assert(user, handover.opportunityId);

    const readiness = await this.readiness(handover.opportunityId, handover);
    const progress = signoffProgress(
      handover.signoffs.map((s) => ({ party: s.party as HandoverParty, isAccepted: s.isAccepted })),
    );

    return { ...handover, readiness, signoffProgress: progress };
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateHandoverDto) {
    const handover = await this.findOne(user, id);
    if (handover.status === 'COMPLETED') {
      throw new BadRequestException('A completed handover is not edited');
    }

    const updated = await this.prisma.projectHandover.update({
      where: { id },
      data: {
        contractId: dto.contractId,
        costBaselineVersionId: dto.costBaselineVersionId,
        projectManagerId: dto.projectManagerId,
        plannedStartDate: dto.plannedStartDate ? new Date(dto.plannedStartDate) : undefined,
      },
    });

    await this.audit.recordUpdate(
      'ProjectHandover',
      id,
      handover as unknown as Record<string, unknown>,
      updated as unknown as Record<string, unknown>,
      user.id,
    );

    return this.findOne(user, id);
  }

  async addItem(user: AuthenticatedUser, handoverId: string, dto: AddHandoverItemDto) {
    await this.findOne(user, handoverId);

    return this.prisma.handoverItem.create({
      data: {
        handoverId,
        category: dto.category as never,
        name: dto.name,
        documentId: dto.documentId,
        responsibleId: dto.responsibleId,
      },
    });
  }

  /**
   * Tick an item, or mark it genuinely not applicable.
   *
   * The two are different facts and the spec's checklist would lie if they
   * were one: an item nobody did and an item that does not apply both read as
   * "not complete" otherwise. Marking it inapplicable therefore costs a reason.
   */
  async updateItem(user: AuthenticatedUser, id: string, dto: UpdateHandoverItemDto) {
    const item = await this.prisma.handoverItem.findFirst({
      where: { id, deletedAt: null },
      include: { handover: { select: { id: true, opportunityId: true, status: true } } },
    });
    if (!item) throw new NotFoundException('Handover item not found');
    await this.opportunities.assert(user, item.handover.opportunityId);

    if (item.handover.status === 'COMPLETED') {
      throw new BadRequestException('A completed handover is not edited');
    }
    if (dto.notApplicable === true && !dto.notApplicableReason?.trim()) {
      throw new BadRequestException(
        'Marking a pack item as not applicable requires a reason',
      );
    }

    const updated = await this.prisma.handoverItem.update({
      where: { id },
      data: {
        isComplete: dto.isComplete,
        notApplicable: dto.notApplicable,
        notApplicableReason: dto.notApplicableReason,
        comment: dto.comment,
        documentId: dto.documentId,
      },
    });

    await this.audit.record({
      entityType: 'HandoverItem',
      entityId: id,
      action: 'UPDATE',
      userId: user.id,
      after: {
        isComplete: updated.isComplete,
        notApplicable: updated.notApplicable,
        reason: updated.notApplicableReason ?? null,
      },
    });

    return updated;
  }

  /**
   * A party accepts or refuses the handover.
   *
   * The gate is checked here rather than at completion, because the point of
   * the spec's exit conditions is that nobody should be asked to accept a pack
   * that is not ready. And a refusal is recorded as its own outcome — the
   * project manager saying they cannot deliver this is the whole reason the
   * meeting exists.
   */
  async sign(user: AuthenticatedUser, handoverId: string, dto: SignoffDto) {
    const handover = await this.findOne(user, handoverId);

    if (handover.status === 'COMPLETED') {
      throw new BadRequestException('This handover is already complete');
    }
    if (dto.accept && !handover.readiness.ready) {
      throw new BadRequestException({
        message:
          'This handover is not ready to be accepted. The conditions below are not met yet.',
        missing: handover.readiness.missing,
      });
    }
    if (!dto.accept && !dto.comment?.trim()) {
      throw new BadRequestException('Refusing a handover requires a reason');
    }

    const row = handover.signoffs.find((s) => s.party === dto.party);
    if (!row) {
      throw new BadRequestException(`${dto.party} is not a party to this handover`);
    }
    if (row.isAccepted !== null && row.isAccepted !== undefined) {
      throw new BadRequestException(`${dto.party} has already answered`);
    }

    await this.prisma.handoverSignoff.update({
      where: { id: row.id },
      data: {
        isAccepted: dto.accept,
        signedById: user.id,
        signedAt: new Date(),
        comment: dto.comment,
      },
    });

    const after = await this.prisma.handoverSignoff.findMany({
      where: { handoverId, deletedAt: null },
    });
    const progress = signoffProgress(
      after.map((s) => ({ party: s.party as HandoverParty, isAccepted: s.isAccepted })),
    );

    const status = progress.rejected.length
      ? 'REJECTED'
      : progress.complete
        ? 'COMPLETED'
        : 'AWAITING_SIGNOFF';

    await this.prisma.projectHandover.update({
      where: { id: handoverId },
      data: {
        status: status as never,
        handoverDate: progress.complete ? new Date() : null,
      },
    });

    await this.audit.record({
      entityType: 'ProjectHandover',
      entityId: handoverId,
      action: 'STATUS_CHANGE',
      userId: user.id,
      after: {
        party: dto.party,
        accepted: dto.accept,
        comment: dto.comment ?? null,
        status,
      },
    });

    await this.notifications.dispatchEvent(
      dto.accept ? 'HANDOVER_SIGNED' : 'HANDOVER_REJECTED',
      {
        title: `${dto.party} ${dto.accept ? 'accepted' : 'refused'} the handover`,
        body: dto.comment ?? '',
        entityType: 'ProjectHandover',
        entityId: handoverId,
      },
    );

    return this.findOne(user, handoverId);
  }

  // -------------------------------------------------------------------------

  /**
   * The spec's exit conditions, evaluated against what the system actually
   * knows rather than against a checklist somebody ticked.
   */
  private async readiness(
    opportunityId: string,
    handover: {
      contract: { reviewedAt: Date | null; contractValue: unknown; deviations: { status: string; riskLevel: string }[] } | null;
      costBaselineVersion: { status: string } | null;
      projectManagerId: string | null;
      plannedStartDate: Date | null;
    },
  ) {
    const awards = await this.prisma.award.findMany({
      where: { opportunityId, deletedAt: null },
      select: { type: true },
    });
    const strongest = awards.reduce<AwardType | null>(
      (best, a) => (best ? strongerAward(best, a.type as AwardType) : (a.type as AwardType)),
      null,
    );

    // Reuses Release 3's readiness rule rather than restating it: one blocking
    // clarification makes the scope unfit, however complete the rest.
    const [packages, assumptions, clarifications] = await Promise.all([
      this.prisma.scopePackage.findMany({
        where: { opportunityId, deletedAt: null },
        include: { items: { where: { deletedAt: null }, select: { id: true } } },
      }),
      this.prisma.assumption.findMany({
        where: { opportunityId, deletedAt: null },
        select: { confirmationStatus: true },
      }),
      this.prisma.clarification.findMany({
        where: { opportunityId, deletedAt: null },
        select: { status: true, impact: true },
      }),
    ]);

    const openStatuses = new Set(['OPEN', 'SENT', 'UNANSWERED_AT_SUBMISSION']);
    const open = clarifications.filter((c) => openStatuses.has(c.status));
    const scope = scopeReadiness({
      packages: packages.length,
      items: packages.reduce((n, p) => n + p.items.length, 0),
      unconfirmedAssumptions: assumptions.filter((a) => a.confirmationStatus !== 'CONFIRMED')
        .length,
      openClarifications: open.length,
      blockingClarifications: open.filter((c) => c.impact === 'BLOCKING').length,
    });

    return handoverReadiness({
      awardType: strongest,
      contractReviewedAt: handover.contract?.reviewedAt ?? null,
      contractValue:
        handover.contract?.contractValue === null || handover.contract?.contractValue === undefined
          ? null
          : Number(handover.contract.contractValue),
      scopeReady: scope.ready,
      costBaselineApproved: handover.costBaselineVersion?.status === 'APPROVED',
      projectManagerId: handover.projectManagerId,
      plannedStartDate: handover.plannedStartDate,
      openCriticalDeviations:
        handover.contract?.deviations.filter(
          (d) => d.status === 'OPEN' && d.riskLevel === 'CRITICAL',
        ).length ?? 0,
    });
  }

  /** Exposed so the opportunity screen can show the gate before a handover exists. */
  async previewReadiness(user: AuthenticatedUser, opportunityId: string) {
    await this.opportunities.assert(user, opportunityId);

    const contract = await this.prisma.contract.findFirst({
      where: { opportunityId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { deviations: { where: { deletedAt: null } } },
    });

    const readiness = await this.readiness(opportunityId, {
      contract,
      costBaselineVersion: null,
      projectManagerId: null,
      plannedStartDate: null,
    });

    const awards = await this.prisma.award.findMany({
      where: { opportunityId, deletedAt: null },
      select: { type: true },
    });
    const strongest = awards.reduce<AwardType | null>(
      (best, a) => (best ? strongerAward(best, a.type as AwardType) : (a.type as AwardType)),
      null,
    );

    return {
      opportunityId,
      strongestAward: strongest,
      awardIsBinding: strongest ? isBinding(strongest) : false,
      readiness,
    };
  }
}
