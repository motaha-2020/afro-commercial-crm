import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  detectDeviations,
  isBinding,
  strongerAward,
  type AwardType,
  type ComparableTerms,
  type DeviationField,
  type RiskLevel,
} from '@acms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CodeGeneratorService } from '../common/code-generator.service';
import { OpportunityAccessService } from '../common/opportunity-access.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type {
  AddDeviationDto,
  CreateContractDto,
  DecideDeviationDto,
  RecordAwardDto,
  UpdateContractDto,
} from './dto';

@Injectable()
export class ContractsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly codes: CodeGeneratorService,
    private readonly opportunities: OpportunityAccessService,
    private readonly notifications: NotificationsService,
  ) {}

  // -------------------------------------------------------------------------
  // Award
  // -------------------------------------------------------------------------

  async listAwards(user: AuthenticatedUser, opportunityId: string) {
    await this.opportunities.assert(user, opportunityId);

    const awards = await this.prisma.award.findMany({
      where: { opportunityId, deletedAt: null },
      orderBy: { awardedAt: 'desc' },
      include: { recordedBy: { select: { id: true, fullNameEn: true, fullNameAr: true } } },
    });

    const strongest = awards.reduce<AwardType | null>(
      (best, a) => (best ? strongerAward(best, a.type as AwardType) : (a.type as AwardType)),
      null,
    );

    return {
      awards,
      // The reading that matters: not the latest award but the firmest one. A
      // customer who phones after sending the purchase order has not
      // un-ordered the work.
      strongest,
      isBinding: strongest ? isBinding(strongest) : false,
    };
  }

  /**
   * Record an award.
   *
   * Awards accumulate rather than replace: a verbal award followed by a letter
   * of intent followed by a signed contract is three facts about the same win,
   * each with its own date, and the sequence is exactly what an auditor asks
   * about when a dispute starts.
   */
  async recordAward(user: AuthenticatedUser, opportunityId: string, dto: RecordAwardDto) {
    await this.opportunities.assert(user, opportunityId);

    const award = await this.prisma.award.create({
      data: {
        code: await this.codes.next('AWD', 'award', new Date().getFullYear()),
        opportunityId,
        type: dto.type,
        awardedAt: new Date(dto.awardedAt),
        awardedValue: dto.awardedValue,
        currency: dto.currency ?? 'USD',
        customerReference: dto.customerReference,
        documentId: dto.documentId,
        erpCostCode: dto.erpCostCode,
        erpCostCenter: dto.erpCostCenter,
        notes: dto.notes,
        recordedById: user.id,
      },
    });

    await this.audit.record({
      entityType: 'Award',
      entityId: award.id,
      action: 'CREATE',
      userId: user.id,
      after: {
        opportunityId,
        type: dto.type,
        isBinding: isBinding(dto.type as AwardType),
        erpCostCode: dto.erpCostCode ?? null,
      },
    });

    await this.notifications.dispatchEvent('AWARD_RECORDED', {
      title: `Award recorded: ${dto.type}`,
      body: isBinding(dto.type as AwardType)
        ? 'Binding — the project may be handed over once the remaining conditions are met'
        : 'Not binding on its own; a purchase order or contract is still needed before handover',
      entityType: 'Award',
      entityId: award.id,
    });

    return award;
  }

  // -------------------------------------------------------------------------
  // Contract
  // -------------------------------------------------------------------------

  async list(user: AuthenticatedUser, opportunityId: string) {
    await this.opportunities.assert(user, opportunityId);

    return this.prisma.contract.findMany({
      where: { opportunityId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        award: true,
        proposalVersion: { select: { id: true, versionNumber: true, sellingPrice: true } },
        deviations: { where: { deletedAt: null } },
        _count: { select: { clauses: true } },
      },
    });
  }

  async findOne(user: AuthenticatedUser, id: string) {
    const contract = await this.prisma.contract.findFirst({
      where: { id, deletedAt: null },
      include: {
        award: true,
        account: { select: { id: true, legalName: true } },
        proposalVersion: {
          select: { id: true, versionNumber: true, sellingPrice: true, validUntil: true },
        },
        clauses: { where: { deletedAt: null } },
        deviations: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
          include: {
            preparedBy: { select: { id: true, fullNameEn: true, fullNameAr: true } },
            approvedBy: { select: { id: true, fullNameEn: true, fullNameAr: true } },
          },
        },
        reviewedBy: { select: { id: true, fullNameEn: true, fullNameAr: true } },
      },
    });
    if (!contract) throw new NotFoundException('Contract not found');
    await this.opportunities.assert(user, contract.opportunityId);
    return contract;
  }

  async create(user: AuthenticatedUser, opportunityId: string, dto: CreateContractDto) {
    const opportunity = await this.prisma.opportunity.findFirst({
      where: { id: opportunityId, deletedAt: null },
      select: { id: true, accountId: true },
    });
    if (!opportunity) throw new NotFoundException('Opportunity not found');
    await this.opportunities.assert(user, opportunityId);

    const contract = await this.prisma.contract.create({
      data: {
        code: await this.codes.next('CNT', 'contract', new Date().getFullYear()),
        opportunityId,
        accountId: opportunity.accountId,
        awardId: dto.awardId,
        proposalVersionId: dto.proposalVersionId,
        contractNumber: dto.contractNumber,
        legalEntity: dto.legalEntity,
        type: (dto.type ?? 'LUMP_SUM') as never,
        contractValue: dto.contractValue,
        currency: dto.currency ?? 'USD',
        startDate: dto.startDate ? new Date(dto.startDate) : null,
        endDate: dto.endDate ? new Date(dto.endDate) : null,
        paymentTerms: dto.paymentTerms,
        retentionPercent: dto.retentionPercent,
        advancePercent: dto.advancePercent,
        warrantyMonths: dto.warrantyMonths,
        ldPercent: dto.ldPercent,
        liabilityCap: dto.liabilityCap,
        governingLaw: dto.governingLaw,
        createdById: user.id,
      },
    });

    await this.audit.record({
      entityType: 'Contract',
      entityId: contract.id,
      action: 'CREATE',
      userId: user.id,
      after: { opportunityId, contractNumber: dto.contractNumber ?? null },
    });

    return contract;
  }

  /**
   * A signed contract is a fact about what the customer holds, so it stops
   * being editable — the same treatment a submitted proposal and an approved
   * costing already get.
   */
  async update(user: AuthenticatedUser, id: string, dto: UpdateContractDto) {
    const contract = await this.findOne(user, id);

    if (contract.status === 'SIGNED' || contract.status === 'ACTIVE') {
      throw new BadRequestException(
        `This contract is ${contract.status}. Record a variation rather than editing what was signed.`,
      );
    }

    const updated = await this.prisma.contract.update({
      where: { id },
      data: {
        ...dto,
        type: dto.type as never,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
      },
    });

    await this.audit.recordUpdate(
      'Contract',
      id,
      contract as unknown as Record<string, unknown>,
      updated as unknown as Record<string, unknown>,
      user.id,
    );

    return updated;
  }

  // -------------------------------------------------------------------------
  // Deviations
  // -------------------------------------------------------------------------

  /**
   * Compare the contract with the proposal it is supposed to embody, and
   * record every difference found.
   *
   * Re-runnable: deviations already decided by a person are left alone, and
   * only the ones nobody has judged are refreshed. Otherwise a second review
   * would silently reopen decisions that were already taken and argued over.
   */
  async review(user: AuthenticatedUser, id: string) {
    const contract = await this.findOne(user, id);

    if (!contract.proposalVersionId || !contract.proposalVersion) {
      throw new BadRequestException(
        'This contract is not linked to a proposal version, so there is nothing to compare it against',
      );
    }

    const proposal = await this.prisma.proposalVersion.findUnique({
      where: { id: contract.proposalVersionId },
      include: { proposal: { select: { opportunityId: true } } },
    });
    if (!proposal) throw new NotFoundException('Proposal version not found');

    // A term the proposal never stated stays null, and detectDeviations then
    // says nothing about it rather than inventing a difference against a zero.
    // `undefined` has to fall through the same path as null: Number(undefined)
    // is NaN, which compares unequal to everything and would report a
    // deviation on every term the proposal simply did not mention.
    const decimal = (v: unknown): number | null =>
      v === null || v === undefined ? null : Number(v);

    const proposalTerms: ComparableTerms = {
      price: decimal(proposal.sellingPrice),
      paymentTerms: proposal.paymentTerms ?? null,
      durationDays: proposal.durationDays ?? null,
      warrantyMonths: proposal.warrantyMonths ?? null,
      ldPercent: decimal(proposal.ldPercent),
      liabilityCap: decimal(proposal.liabilityCap),
    };

    const contractTerms: ComparableTerms = {
      price: decimal(contract.contractValue),
      paymentTerms: contract.paymentTerms ?? null,
      durationDays:
        contract.startDate && contract.endDate
          ? Math.round(
              (contract.endDate.getTime() - contract.startDate.getTime()) / 86_400_000,
            )
          : null,
      warrantyMonths: contract.warrantyMonths ?? null,
      ldPercent: decimal(contract.ldPercent),
      liabilityCap: decimal(contract.liabilityCap),
    };

    const detected = detectDeviations(proposalTerms, contractTerms);

    const existing = await this.prisma.contractDeviation.findMany({
      where: { contractId: id, deletedAt: null },
    });
    const decidedFields = new Set(
      existing.filter((d) => d.status !== 'OPEN').map((d) => d.field as string),
    );

    await this.prisma.$transaction(async (tx) => {
      // Clear only the undecided machine-found rows; a person's judgement is
      // never overwritten by a re-run.
      await tx.contractDeviation.updateMany({
        where: { contractId: id, status: 'OPEN', isDetected: true, deletedAt: null },
        data: { deletedAt: new Date() },
      });

      for (const d of detected) {
        if (decidedFields.has(d.field)) continue;
        await tx.contractDeviation.create({
          data: {
            contractId: id,
            field: d.field as DeviationField as never,
            proposalValue: d.proposalValue,
            contractValue: d.contractValue,
            riskLevel: d.riskLevel as RiskLevel as never,
            impact: d.direction,
            preparedById: user.id,
            isDetected: true,
          },
        });
      }

      await tx.contract.update({
        where: { id },
        data: {
          status: contract.status === 'DRAFT' ? 'REVIEWED' : contract.status,
          reviewedAt: new Date(),
          reviewedById: user.id,
        },
      });
    });

    await this.audit.record({
      entityType: 'Contract',
      entityId: id,
      action: 'STATUS_CHANGE',
      userId: user.id,
      after: {
        reviewed: true,
        deviationsFound: detected.length,
        critical: detected.filter((d) => d.riskLevel === 'CRITICAL').length,
      },
    });

    if (detected.some((d) => d.riskLevel === 'CRITICAL')) {
      await this.notifications.dispatchEvent('CONTRACT_DEVIATION_CRITICAL', {
        title: `Critical contract deviation: ${contract.contractNumber ?? contract.code}`,
        body: detected
          .filter((d) => d.riskLevel === 'CRITICAL')
          .map((d) => `${d.field}: ${d.proposalValue ?? '—'} → ${d.contractValue ?? '—'}`)
          .join(' • '),
        entityType: 'Contract',
        entityId: id,
      });
    }

    return this.findOne(user, id);
  }

  /** A deviation a person spotted that the comparison could not see. */
  async addDeviation(user: AuthenticatedUser, contractId: string, dto: AddDeviationDto) {
    await this.findOne(user, contractId);

    const deviation = await this.prisma.contractDeviation.create({
      data: {
        contractId,
        field: dto.field as never,
        clauseName: dto.clauseName,
        proposalValue: dto.proposalValue,
        contractValue: dto.contractValue,
        impact: dto.impact,
        riskLevel: (dto.riskLevel ?? 'MEDIUM') as never,
        preparedById: user.id,
        isDetected: false,
      },
    });

    await this.audit.record({
      entityType: 'ContractDeviation',
      entityId: deviation.id,
      action: 'CREATE',
      userId: user.id,
      after: { contractId, field: dto.field, manual: true },
    });

    return deviation;
  }

  /**
   * Accept, reject or mitigate a deviation.
   *
   * SOD_06: "من يعد Contract Deviation لا يكون صاحب الاعتماد النهائي لنفس
   * الانحراف". Whoever prepared it does not decide it — and since the review
   * itself records the preparer, the person who ran the comparison cannot wave
   * through what it found.
   */
  async decideDeviation(user: AuthenticatedUser, id: string, dto: DecideDeviationDto) {
    const deviation = await this.prisma.contractDeviation.findFirst({
      where: { id, deletedAt: null },
      include: { contract: { select: { id: true, opportunityId: true } } },
    });
    if (!deviation) throw new NotFoundException('Deviation not found');
    await this.opportunities.assert(user, deviation.contract.opportunityId);

    if (deviation.status !== 'OPEN') {
      throw new BadRequestException(`This deviation is already ${deviation.status}`);
    }

    if (deviation.preparedById === user.id) {
      await this.audit.record({
        entityType: 'ContractDeviation',
        entityId: id,
        action: 'SOD_BLOCKED',
        userId: user.id,
        after: { rule: 'SOD_06', attemptedAction: 'CONTRACT_DEVIATION_APPROVE' },
      });
      throw new ForbiddenException(
        'Segregation of duties (SOD_06): whoever prepares a contract deviation is not its final approver',
      );
    }

    // Accepting a critical deviation means accepting unlimited liability or a
    // penalty nobody priced. It is allowed — but not silently.
    if (dto.status === 'ACCEPTED' && deviation.riskLevel === 'CRITICAL' && !dto.note?.trim()) {
      throw new BadRequestException(
        'Accepting a critical deviation requires a written reason',
      );
    }
    if (dto.status === 'REJECTED' && !dto.note?.trim()) {
      throw new BadRequestException('Rejecting a deviation requires a reason');
    }

    const updated = await this.prisma.contractDeviation.update({
      where: { id },
      data: {
        status: dto.status as never,
        approvedById: user.id,
        approvedAt: new Date(),
        decisionNote: dto.note,
      },
    });

    await this.audit.record({
      entityType: 'ContractDeviation',
      entityId: id,
      action: 'STATUS_CHANGE',
      userId: user.id,
      before: { status: 'OPEN', riskLevel: deviation.riskLevel },
      after: { status: dto.status, note: dto.note ?? null },
    });

    return updated;
  }
}
