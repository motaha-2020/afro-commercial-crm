import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  DEFAULT_QUOTATION_WEIGHTS,
  SUPERSEDED_BY_QUOTE,
  compareQuotations,
  costSourceForPartner,
  isQuotationExpired,
  reachedTheCosting,
  rollup,
  weightedQuotationScore,
  type ComparableQuotation,
  type PartnerApprovalStatus,
  type PartnerType,
  type QuoteApplicationOutcome,
  type QuoteApplicationSkip,
} from '@acms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CodeGeneratorService } from '../common/code-generator.service';
import { DataScopeService } from '../auth/data-scope.service';
import { OpportunityAccessService } from '../common/opportunity-access.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type {
  AddRfqRecipientsDto,
  CreateQuotationDto,
  CreateRfqDto,
  EvaluateQuotationDto,
  QuotationLineDto,
  SelectQuotationDto,
  UpdateQuotationDto,
  UpdateRfqDto,
} from './dto';

@Injectable()
export class QuotationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly codes: CodeGeneratorService,
    private readonly scope: DataScopeService,
    private readonly opportunities: OpportunityAccessService,
    private readonly notifications: NotificationsService,
  ) {}

  // -------------------------------------------------------------------------
  // RFQs
  // -------------------------------------------------------------------------

  async listRfqs(user: AuthenticatedUser, opportunityId: string) {
    await this.opportunities.assert(user, opportunityId);

    return this.prisma.rfq.findMany({
      where: { opportunityId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        recipients: {
          where: { deletedAt: null },
          include: { partner: { select: { id: true, code: true, legalName: true } } },
        },
        _count: { select: { quotations: true } },
      },
    });
  }

  async createRfq(user: AuthenticatedUser, opportunityId: string, dto: CreateRfqDto) {
    await this.opportunities.assert(user, opportunityId);

    if (dto.partnerIds?.length) {
      await this.assertPartnersUsable(user, dto.partnerIds);
    }

    const year = new Date().getFullYear();
    const code = await this.codes.next('RFQ', 'rfq', year);

    const rfq = await this.prisma.rfq.create({
      data: {
        code,
        opportunityId,
        title: dto.title,
        description: dto.description,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined,
        currency: dto.currency ?? 'USD',
        createdById: user.id,
        status: 'DRAFT',
        recipients: dto.partnerIds?.length
          ? { create: [...new Set(dto.partnerIds)].map((partnerId) => ({ partnerId })) }
          : undefined,
      },
      include: { recipients: { where: { deletedAt: null } } },
    });

    await this.audit.record({
      entityType: 'Rfq',
      entityId: rfq.id,
      action: 'CREATE',
      userId: user.id,
      after: { code: rfq.code, title: rfq.title, recipients: dto.partnerIds?.length ?? 0 },
    });

    return rfq;
  }

  async updateRfq(user: AuthenticatedUser, id: string, dto: UpdateRfqDto) {
    const existing = await this.findRfq(user, id);

    // Issuing is the moment the RFQ leaves the building; it needs somebody to
    // have gone to, or it is a document addressed to nobody.
    if (dto.status === 'ISSUED' && existing.status === 'DRAFT') {
      const recipients = await this.prisma.rfqRecipient.count({
        where: { rfqId: id, deletedAt: null },
      });
      if (recipients === 0) {
        throw new BadRequestException('An RFQ cannot be issued with no recipients');
      }
    }

    const updated = await this.prisma.rfq.update({
      where: { id },
      data: {
        ...dto,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined,
        issuedAt:
          dto.status === 'ISSUED' && !existing.issuedAt ? new Date() : undefined,
      },
    });

    await this.audit.recordUpdate(
      'Rfq',
      id,
      existing as unknown as Record<string, unknown>,
      updated as unknown as Record<string, unknown>,
      user.id,
    );

    if (dto.status === 'ISSUED' && existing.status !== 'ISSUED') {
      await this.notifications.dispatchEvent('RFQ_ISSUED', {
        title: `RFQ issued: ${updated.title}`,
        body: updated.code,
        entityType: 'Rfq',
        entityId: id,
      });
    }

    return updated;
  }

  async addRecipients(user: AuthenticatedUser, id: string, dto: AddRfqRecipientsDto) {
    const rfq = await this.findRfq(user, id);
    await this.assertPartnersUsable(user, dto.partnerIds);

    for (const partnerId of [...new Set(dto.partnerIds)]) {
      await this.prisma.rfqRecipient.upsert({
        where: { rfqId_partnerId: { rfqId: id, partnerId } },
        create: { rfqId: id, partnerId },
        update: { deletedAt: null },
      });
    }

    await this.audit.record({
      entityType: 'Rfq',
      entityId: id,
      action: 'UPDATE',
      userId: user.id,
      after: { addedRecipients: dto.partnerIds, rfq: rfq.code },
    });

    return this.findRfq(user, id);
  }

  private async findRfq(user: AuthenticatedUser, id: string) {
    const rfq = await this.prisma.rfq.findFirst({
      where: { id, deletedAt: null },
      include: {
        recipients: {
          where: { deletedAt: null },
          include: { partner: { select: { id: true, code: true, legalName: true } } },
        },
      },
    });
    if (!rfq) throw new NotFoundException('RFQ not found');
    await this.opportunities.assert(user, rfq.opportunityId);
    return rfq;
  }

  // -------------------------------------------------------------------------
  // Quotations
  // -------------------------------------------------------------------------

  async listQuotations(user: AuthenticatedUser, opportunityId: string) {
    await this.opportunities.assert(user, opportunityId);

    const rows = await this.prisma.partnerQuotation.findMany({
      where: { opportunityId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        partner: {
          select: {
            id: true,
            code: true,
            legalName: true,
            isBlacklisted: true,
            approvalStatus: true,
          },
        },
        items: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } },
        evaluations: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: { evaluator: { select: { id: true, fullNameEn: true, fullNameAr: true } } },
        },
      },
    });

    const now = new Date();
    return rows.map((q) => ({ ...q, isExpired: isQuotationExpired(q.validUntil, now) }));
  }

  async findQuotation(user: AuthenticatedUser, id: string) {
    const quotation = await this.prisma.partnerQuotation.findFirst({
      where: { id, deletedAt: null },
      include: {
        partner: true,
        rfq: { select: { id: true, code: true, title: true } },
        items: {
          where: { deletedAt: null },
          orderBy: { sortOrder: 'asc' },
          include: { boqItem: { select: { id: true, itemNumber: true, description: true } } },
        },
        evaluations: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          include: { evaluator: { select: { id: true, fullNameEn: true, fullNameAr: true } } },
        },
        selectedBy: { select: { id: true, fullNameEn: true, fullNameAr: true } },
      },
    });
    if (!quotation) throw new NotFoundException('Quotation not found');
    await this.opportunities.assert(user, quotation.opportunityId);

    return { ...quotation, isExpired: isQuotationExpired(quotation.validUntil, new Date()) };
  }

  async createQuotation(
    user: AuthenticatedUser,
    opportunityId: string,
    dto: CreateQuotationDto,
  ) {
    await this.opportunities.assert(user, opportunityId);
    const [partner] = await this.assertPartnersUsable(user, [dto.partnerId]);

    if (dto.rfqId) {
      const rfq = await this.findRfq(user, dto.rfqId);
      if (rfq.opportunityId !== opportunityId) {
        throw new BadRequestException('That RFQ belongs to a different opportunity');
      }
    }

    const year = new Date().getFullYear();
    const code = await this.codes.next('QUO', 'quotation', year);
    const items = (dto.items ?? []).map((line, index) => this.toItemRow(line, index));
    const totalValue = items.reduce((sum, i) => sum + i.totalPrice, 0);

    const quotation = await this.prisma.partnerQuotation.create({
      data: {
        code,
        partnerId: dto.partnerId,
        opportunityId,
        rfqId: dto.rfqId,
        quotationNumber: dto.quotationNumber,
        quotationDate: dto.quotationDate ? new Date(dto.quotationDate) : undefined,
        validUntil: dto.validUntil ? new Date(dto.validUntil) : undefined,
        currency: dto.currency ?? 'USD',
        paymentTerms: dto.paymentTerms,
        deliveryDays: dto.deliveryDays,
        warranty: dto.warranty,
        freightTerms: dto.freightTerms,
        taxTreatment: dto.taxTreatment,
        landedAdjustment: dto.landedAdjustment,
        // Rolled up from the lines rather than typed in, so the header can
        // never disagree with what was actually quoted.
        totalValue,
        receivedById: user.id,
        items: items.length ? { create: items } : undefined,
      },
      include: { items: true },
    });

    if (dto.rfqId) {
      await this.prisma.rfqRecipient.updateMany({
        where: { rfqId: dto.rfqId, partnerId: dto.partnerId, deletedAt: null },
        data: { respondedAt: new Date() },
      });
    }

    await this.audit.record({
      entityType: 'PartnerQuotation',
      entityId: quotation.id,
      action: 'CREATE',
      userId: user.id,
      after: {
        code: quotation.code,
        partner: partner.legalName,
        totalValue,
        lines: items.length,
      },
    });

    return quotation;
  }

  async updateQuotation(user: AuthenticatedUser, id: string, dto: UpdateQuotationDto) {
    const existing = await this.findQuotation(user, id);
    this.assertNotSelected(existing);

    const updated = await this.prisma.partnerQuotation.update({
      where: { id },
      data: {
        ...dto,
        quotationDate: dto.quotationDate ? new Date(dto.quotationDate) : undefined,
        validUntil: dto.validUntil ? new Date(dto.validUntil) : undefined,
      },
    });

    await this.audit.recordUpdate(
      'PartnerQuotation',
      id,
      existing as unknown as Record<string, unknown>,
      updated as unknown as Record<string, unknown>,
      user.id,
    );

    return updated;
  }

  async addLine(user: AuthenticatedUser, id: string, dto: QuotationLineDto) {
    const quotation = await this.findQuotation(user, id);
    this.assertNotSelected(quotation);

    if (dto.boqItemId) await this.assertBoqItemBelongs(dto.boqItemId, quotation.opportunityId);

    const row = this.toItemRow(dto, quotation.items.length);
    const item = await this.prisma.partnerQuotationItem.create({
      data: { ...row, quotationId: id },
    });

    await this.recalculateTotal(id);

    await this.audit.record({
      entityType: 'PartnerQuotation',
      entityId: id,
      action: 'UPDATE',
      userId: user.id,
      after: { addedLine: item.description, totalPrice: row.totalPrice },
    });

    return item;
  }

  async removeLine(user: AuthenticatedUser, quotationId: string, lineId: string) {
    const quotation = await this.findQuotation(user, quotationId);
    this.assertNotSelected(quotation);

    const line = await this.prisma.partnerQuotationItem.findFirst({
      where: { id: lineId, quotationId, deletedAt: null },
    });
    if (!line) throw new NotFoundException('Quotation line not found');

    await this.prisma.partnerQuotationItem.update({
      where: { id: lineId },
      data: { deletedAt: new Date() },
    });
    await this.recalculateTotal(quotationId);

    await this.audit.record({
      entityType: 'PartnerQuotation',
      entityId: quotationId,
      action: 'UPDATE',
      userId: user.id,
      before: { removedLine: line.description },
    });

    return { success: true };
  }

  async removeQuotation(user: AuthenticatedUser, id: string) {
    const existing = await this.findQuotation(user, id);
    this.assertNotSelected(existing);

    await this.prisma.partnerQuotation.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await this.audit.record({
      entityType: 'PartnerQuotation',
      entityId: id,
      action: 'SOFT_DELETE',
      userId: user.id,
      before: { code: existing.code },
    });

    return { success: true };
  }

  // -------------------------------------------------------------------------
  // Evaluation, comparison and selection
  // -------------------------------------------------------------------------

  async evaluate(user: AuthenticatedUser, id: string, dto: EvaluateQuotationDto) {
    const quotation = await this.findQuotation(user, id);
    this.assertNotSelected(quotation);

    const scores = {
      PRICE: dto.priceScore,
      TECHNICAL: dto.technicalScore,
      DELIVERY: dto.deliveryScore,
      PAYMENT: dto.paymentScore,
      QUALITY: dto.qualityScore,
      RISK: dto.riskScore,
    };
    const weightedScore = weightedQuotationScore(scores, DEFAULT_QUOTATION_WEIGHTS);

    const evaluation = await this.prisma.quotationEvaluation.create({
      data: {
        quotationId: id,
        priceScore: dto.priceScore,
        technicalScore: dto.technicalScore,
        deliveryScore: dto.deliveryScore,
        paymentScore: dto.paymentScore,
        qualityScore: dto.qualityScore,
        riskScore: dto.riskScore,
        weightedScore,
        // The weights in force are stored on the row: an old comparison must
        // stay readable with the numbers that actually produced it.
        weightsUsed: DEFAULT_QUOTATION_WEIGHTS as unknown as Prisma.InputJsonValue,
        recommendation: dto.recommendation,
        evaluatorId: user.id,
      },
    });

    await this.audit.record({
      entityType: 'PartnerQuotation',
      entityId: id,
      action: 'UPDATE',
      userId: user.id,
      after: { evaluated: true, weightedScore, recommendation: dto.recommendation ?? null },
    });

    return evaluation;
  }

  /**
   * The supplier comparison the spec asks for.
   *
   * It returns four different winners plus a recommendation and never marks
   * anything as chosen — "يجب ألا يختار النظام أقل سعر تلقائيًا". Selection is
   * a separate, deliberate call by a person.
   */
  async compare(user: AuthenticatedUser, opportunityId: string) {
    await this.opportunities.assert(user, opportunityId);
    const quotations = await this.listQuotations(user, opportunityId);

    const comparable: ComparableQuotation[] = quotations.map((q) => ({
      id: q.id,
      partnerId: q.partnerId,
      partnerName: q.partner.legalName,
      totalValue: Number(q.totalValue),
      landedAdjustment: q.landedAdjustment ? Number(q.landedAdjustment) : undefined,
      technicalScore: q.evaluations[0]?.technicalScore ?? undefined,
      weightedScore: q.evaluations[0]?.weightedScore
        ? Number(q.evaluations[0].weightedScore)
        : undefined,
      deliveryDays: q.deliveryDays ?? undefined,
      validUntil: q.validUntil ? q.validUntil.toISOString() : null,
      blacklisted: q.partner.isBlacklisted,
      approvalStatus: q.partner.approvalStatus as PartnerApprovalStatus,
    }));

    return {
      views: compareQuotations(comparable, new Date()),
      quotations: quotations.map((q) => ({
        id: q.id,
        code: q.code,
        partner: q.partner,
        totalValue: q.totalValue,
        landedAdjustment: q.landedAdjustment,
        currency: q.currency,
        deliveryDays: q.deliveryDays,
        validUntil: q.validUntil,
        isExpired: q.isExpired,
        isSelected: q.isSelected,
        technicalStatus: q.technicalStatus,
        commercialStatus: q.commercialStatus,
        evaluation: q.evaluations[0] ?? null,
      })),
      weights: DEFAULT_QUOTATION_WEIGHTS,
    };
  }

  /**
   * Selecting the winning quotation. Three gates, each from the spec:
   *
   *  - a blacklisted, suspended or expired offer cannot be chosen at all;
   *  - departing from the system's recommendation requires a written reason,
   *    the same shape as the Bid/No-Bid override already in the system;
   *  - whoever wrote the recommendation is not the one who acts on it, which
   *    is SoD rule 3's principle — "من يوصي بالمورد لا يعتمد أمر الشراء
   *    منفردًا" — applied at the commitment that exists in this release.
   */
  async select(user: AuthenticatedUser, id: string, dto: SelectQuotationDto) {
    const quotation = await this.findQuotation(user, id);

    if (quotation.isSelected) {
      throw new BadRequestException('This quotation is already the selected one');
    }
    if (quotation.partner.isBlacklisted) {
      throw new BadRequestException(
        `${quotation.partner.legalName} is blacklisted and cannot be awarded work`,
      );
    }
    if (quotation.partner.approvalStatus === 'SUSPENDED') {
      throw new BadRequestException(
        `${quotation.partner.legalName} is suspended and cannot be awarded work`,
      );
    }
    if (quotation.isExpired) {
      throw new BadRequestException(
        'This quotation has expired; ask the partner to reconfirm it before selecting',
      );
    }

    const recommender = quotation.evaluations.find((e) => e.recommendation)?.evaluatorId;
    if (recommender && recommender === user.id) {
      await this.audit.record({
        entityType: 'PartnerQuotation',
        entityId: id,
        action: 'SOD_BLOCKED',
        userId: user.id,
        after: { rule: 'SOD_03', attemptedAction: 'QUOTATION_SELECT' },
      });
      throw new ForbiddenException(
        'Segregation of duties (SOD_03): whoever recommends a partner does not also select their quotation',
      );
    }

    const comparison = await this.compare(user, quotation.opportunityId);
    const recommendedId = comparison.views.recommendedId;
    const departsFromRecommendation = recommendedId !== null && recommendedId !== id;

    if (departsFromRecommendation && !dto.rationale?.trim()) {
      throw new BadRequestException(
        'This is not the recommended offer — record why it was chosen instead',
      );
    }

    const [selected] = await this.prisma.$transaction([
      this.prisma.partnerQuotation.update({
        where: { id },
        data: {
          isSelected: true,
          selectedAt: new Date(),
          selectedById: user.id,
          selectionRationale: dto.rationale,
        },
      }),
      // Only one offer wins per opportunity; the previous choice is unset in
      // the same transaction rather than leaving two rows both claiming it.
      this.prisma.partnerQuotation.updateMany({
        where: {
          opportunityId: quotation.opportunityId,
          isSelected: true,
          deletedAt: null,
          NOT: { id },
        },
        data: { isSelected: false, selectedAt: null, selectedById: null },
      }),
    ]);

    await this.audit.record({
      entityType: 'PartnerQuotation',
      entityId: id,
      action: 'STATUS_CHANGE',
      userId: user.id,
      after: {
        selected: true,
        partner: quotation.partner.legalName,
        recommendedId,
        departedFromRecommendation: departsFromRecommendation,
        rationale: dto.rationale ?? null,
      },
    });

    // The half of this release that makes it worth having: the chosen price
    // stops being a fact only procurement knows and becomes the number the bid
    // is actually built on.
    const costing = await this.applyToCosting(user, id);

    await this.notifications.dispatchEvent('QUOTATION_SELECTED', {
      title: `Quotation selected: ${quotation.partner.legalName}`,
      body: departsFromRecommendation
        ? `Departed from the recommendation — ${dto.rationale}`
        : 'Matches the recommendation',
      entityType: 'PartnerQuotation',
      entityId: id,
    });

    // Worth its own notification only when the costing did NOT follow the
    // decision. Someone has to know the bid is still priced on the estimate.
    if (!reachedTheCosting(costing)) {
      const locked = costing.skipped.find((s) => s.reason === 'COSTING_LOCKED');
      if (locked) {
        await this.notifications.dispatchEvent('QUOTATION_SELECTED', {
          title: `Costing not updated: ${quotation.partner.legalName}`,
          body:
            'The selection stands, but the costing version is approved and locked. ' +
            'Create a new version to price the bid on this quotation.',
          entityType: 'PartnerQuotation',
          entityId: id,
        });
      }
    }

    return { ...selected, departedFromRecommendation: departsFromRecommendation, costing };
  }

  /**
   * Writes a selected quotation's lines into the cost breakdown of the BOQ
   * items they were quoted against.
   *
   * Three things this deliberately does NOT do:
   *
   * It does not edit a locked costing version. The spec's rule is absolute —
   * an approved costing is never modified — and procurement choosing a supplier
   * is not an exception to it. Those items are skipped and reported, and the
   * way forward is a new version raised by a person.
   *
   * It does not convert currencies. Applying a quote priced in EUR to a costing
   * kept in USD would mean inventing a rate and burying it inside a cost line
   * where nobody would ever find it again.
   *
   * It does not fail the selection. Choosing a supplier is a procurement act
   * that stands on its own; if the numbers cannot follow it right now, that is
   * reported loudly rather than used to reject a decision already taken.
   */
  private async applyToCosting(
    user: AuthenticatedUser,
    quotationId: string,
  ): Promise<QuoteApplicationOutcome> {
    const quotation = await this.prisma.partnerQuotation.findUnique({
      where: { id: quotationId },
      include: {
        partner: { include: { types: { where: { deletedAt: null } } } },
        items: { where: { deletedAt: null } },
      },
    });

    const outcome: QuoteApplicationOutcome = {
      applied: 0,
      superseded: 0,
      retained: 0,
      skipped: [],
    };
    if (!quotation) return outcome;

    const skip = (reason: QuoteApplicationSkip) => {
      const row = outcome.skipped.find((s) => s.reason === reason);
      if (row) row.count += 1;
      else outcome.skipped.push({ reason, count: 1 });
    };

    const source = costSourceForPartner(
      quotation.partner.types.map((t) => t.type as PartnerType),
    );

    for (const item of quotation.items) {
      if (!item.boqItemId) {
        skip('NOT_MAPPED_TO_BOQ');
        continue;
      }

      const boqItem = await this.prisma.boqItem.findFirst({
        where: { id: item.boqItemId, deletedAt: null },
        include: {
          package: {
            include: {
              version: { include: { scenario: true } },
            },
          },
          breakdown: { where: { deletedAt: null } },
        },
      });
      if (!boqItem) {
        skip('NOT_MAPPED_TO_BOQ');
        continue;
      }

      const version = boqItem.package.version;
      const scenario = version.scenario;

      // A quotation line pointing at another opportunity's BOQ is not a
      // mapping to honour; it is a mistake to refuse.
      if (scenario.opportunityId !== quotation.opportunityId) {
        skip('BOQ_ITEM_FOREIGN');
        continue;
      }
      if (version.lockedAt || version.status === 'APPROVED' || version.status === 'SUPERSEDED') {
        skip('COSTING_LOCKED');
        continue;
      }
      if (scenario.currency !== quotation.currency) {
        skip('CURRENCY_MISMATCH');
        continue;
      }

      const displaced = boqItem.breakdown.filter((b) =>
        SUPERSEDED_BY_QUOTE.includes(b.source),
      );
      const retained = boqItem.breakdown.length - displaced.length;

      await this.prisma.$transaction(async (tx) => {
        // Superseded, not deleted: the estimate stays in the row's history and
        // in the audit log, so "what did we think before the quote came in?"
        // remains answerable.
        if (displaced.length) {
          await tx.costBreakdown.updateMany({
            where: { id: { in: displaced.map((d) => d.id) } },
            data: { deletedAt: new Date() },
          });
        }

        await tx.costBreakdown.create({
          data: {
            boqItemId: boqItem.id,
            description: item.description,
            quantity: item.quantity,
            unit: item.unit,
            unitCost: item.unitPrice,
            totalCost: item.totalPrice,
            source,
            sourceReference: `${quotation.code} · ${quotation.partner.legalName}`,
          },
        });
      });

      for (const line of displaced) {
        await this.audit.record({
          entityType: 'CostBreakdown',
          entityId: line.id,
          action: 'SOFT_DELETE',
          userId: user.id,
          before: { source: line.source, totalCost: Number(line.totalCost) },
          after: { supersededBy: quotation.code, reason: 'SELECTED_QUOTATION' },
        });
      }

      await this.recalculateBoqItem(boqItem.id);

      outcome.applied += 1;
      outcome.superseded += displaced.length;
      outcome.retained += retained;
    }

    if (outcome.applied || outcome.superseded) {
      await this.audit.record({
        entityType: 'PartnerQuotation',
        entityId: quotationId,
        action: 'UPDATE',
        userId: user.id,
        after: { costingApplied: outcome as unknown as Prisma.InputJsonObject, source },
      });
    }

    return outcome;
  }

  /**
   * Re-derives the item's cost from its surviving lines. Deliberately does not
   * touch the selling price: learning that a supplier is cheaper than assumed
   * is not a decision to sell for less, and quietly repricing would hand away
   * the margin the moment procurement did its job well.
   */
  private async recalculateBoqItem(boqItemId: string) {
    const item = await this.prisma.boqItem.findUnique({
      where: { id: boqItemId },
      include: { breakdown: { where: { deletedAt: null } } },
    });
    if (!item) return;

    const cost = item.breakdown.reduce((sum, b) => sum + Number(b.totalCost), 0);
    // rollup() rather than the arithmetic inline: margin is over price, never
    // over cost, and one definition of that is the whole point of keeping it
    // in @acms/shared.
    const totals = rollup([{ cost, price: Number(item.sellingTotal ?? 0) }]);

    await this.prisma.boqItem.update({
      where: { id: boqItemId },
      data: {
        internalCost: totals.totalCost,
        grossProfit: totals.grossProfit,
        grossMargin: totals.marginPercent,
      },
    });
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private toItemRow(line: QuotationLineDto, index: number) {
    return {
      description: line.description,
      quantity: line.quantity,
      unit: line.unit,
      unitPrice: line.unitPrice,
      // Computed here, never taken from the client — a total that disagrees
      // with quantity x rate is how a comparison quietly goes wrong.
      totalPrice: Number((line.quantity * line.unitPrice).toFixed(2)),
      boqItemId: line.boqItemId,
      leadTimeDays: line.leadTimeDays,
      compliance: line.compliance ?? 'COMPLIANT',
      exception: line.exception,
      notes: line.notes,
      sortOrder: line.sortOrder ?? index,
    };
  }

  private async recalculateTotal(quotationId: string) {
    const lines = await this.prisma.partnerQuotationItem.findMany({
      where: { quotationId, deletedAt: null },
      select: { totalPrice: true },
    });
    const totalValue = lines.reduce((sum, l) => sum + Number(l.totalPrice), 0);
    await this.prisma.partnerQuotation.update({
      where: { id: quotationId },
      data: { totalValue },
    });
  }

  /** A selected quotation is the basis of a priced bid and stops being editable. */
  private assertNotSelected(quotation: { isSelected: boolean }) {
    if (quotation.isSelected) {
      throw new BadRequestException(
        'A selected quotation is locked; deselect it by selecting another before editing',
      );
    }
  }

  private async assertBoqItemBelongs(boqItemId: string, opportunityId: string) {
    const item = await this.prisma.boqItem.findFirst({
      where: { id: boqItemId, deletedAt: null },
      select: { package: { select: { version: { select: { scenario: { select: { opportunityId: true } } } } } } },
    });
    if (!item) throw new NotFoundException('BOQ item not found');
    if (item.package.version.scenario.opportunityId !== opportunityId) {
      throw new BadRequestException('That BOQ item belongs to a different opportunity');
    }
  }

  /**
   * A quotation may be recorded from any partner the caller can see, but not
   * from a blacklisted one — capturing an offer we can never accept only
   * pollutes the comparison.
   */
  private async assertPartnersUsable(user: AuthenticatedUser, partnerIds: string[]) {
    const scopeFilter = await this.scope.buildFilter(user);
    const partners = await this.prisma.businessPartner.findMany({
      where: { id: { in: partnerIds }, deletedAt: null, ...scopeFilter },
      select: { id: true, legalName: true, isBlacklisted: true },
    });

    if (partners.length !== new Set(partnerIds).size) {
      throw new NotFoundException('Partner not found');
    }
    const banned = partners.find((p) => p.isBlacklisted);
    if (banned) {
      throw new BadRequestException(`${banned.legalName} is blacklisted`);
    }
    return partners;
  }
}
