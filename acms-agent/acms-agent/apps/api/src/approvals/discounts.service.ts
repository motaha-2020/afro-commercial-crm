import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CodeGeneratorService } from '../common/code-generator.service';
import { OpportunityAccessService } from '../common/opportunity-access.service';
import { PoliciesService } from './policies.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { CreateDiscountRequestDto, DecideDiscountDto } from './dto';

/**
 * Discounts get their own small module because SOD_04 names them specifically:
 * "من يطلب خصمًا لا يعتمد الخصم الخاص به". Folding them into the generic
 * approval flow would have satisfied SOD_07 (nobody approves their own request)
 * but lost the ceiling — the number below which a salesperson needs nobody's
 * permission at all, which is itself a configurable policy.
 */
@Injectable()
export class DiscountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly codes: CodeGeneratorService,
    private readonly opportunities: OpportunityAccessService,
    private readonly policies: PoliciesService,
  ) {}

  async list(user: AuthenticatedUser, opportunityId: string) {
    await this.opportunities.assert(user, opportunityId);
    return this.prisma.discountRequest.findMany({
      where: { opportunityId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        requestedBy: { select: { id: true, fullNameEn: true, fullNameAr: true } },
        decidedBy: { select: { id: true, fullNameEn: true, fullNameAr: true } },
      },
    });
  }

  async create(user: AuthenticatedUser, opportunityId: string, dto: CreateDiscountRequestDto) {
    const opportunity = await this.opportunities.assert(user, opportunityId);

    if (dto.toPrice > dto.fromPrice) {
      throw new BadRequestException('A discount lowers the price; toPrice cannot exceed fromPrice');
    }

    const ceiling = await this.policies.valueOf('MAX_DISCOUNT_PERCENT', {
      country: opportunity.country,
      orgUnitId: opportunity.orgUnitId,
      opportunityId,
    });

    const request = await this.prisma.discountRequest.create({
      data: {
        code: await this.codes.next('DSC', 'discountRequest', new Date().getFullYear()),
        opportunityId,
        requestedPercent: dto.requestedPercent,
        fromPrice: dto.fromPrice,
        toPrice: dto.toPrice,
        justification: dto.justification,
        requestedById: user.id,
        // Inside the configured ceiling it needs nobody: that is what a
        // delegated authority means. Above it, or with no ceiling configured,
        // it waits for a decision.
        status: ceiling !== null && dto.requestedPercent <= ceiling ? 'APPROVED' : 'PENDING',
        decidedAt: ceiling !== null && dto.requestedPercent <= ceiling ? new Date() : null,
        decisionNote:
          ceiling !== null && dto.requestedPercent <= ceiling
            ? `Within the delegated authority of ${ceiling}%`
            : null,
      },
    });

    await this.audit.record({
      entityType: 'DiscountRequest',
      entityId: request.id,
      action: 'CREATE',
      userId: user.id,
      after: {
        opportunityId,
        requestedPercent: dto.requestedPercent,
        ceiling,
        autoApproved: request.status === 'APPROVED',
      },
    });

    return { ...request, ceiling, ceilingConfigured: ceiling !== null };
  }

  /** SOD_04: whoever asked for the discount does not grant it. */
  async decide(user: AuthenticatedUser, id: string, dto: DecideDiscountDto) {
    const request = await this.prisma.discountRequest.findFirst({
      where: { id, deletedAt: null },
    });
    if (!request) throw new NotFoundException('Discount request not found');
    await this.opportunities.assert(user, request.opportunityId);

    if (request.status !== 'PENDING') {
      throw new BadRequestException(`This request is already ${request.status}`);
    }

    if (request.requestedById === user.id) {
      await this.audit.record({
        entityType: 'DiscountRequest',
        entityId: id,
        action: 'SOD_BLOCKED',
        userId: user.id,
        after: { rule: 'SOD_04', attemptedAction: 'DISCOUNT_APPROVE' },
      });
      throw new ForbiddenException(
        'Segregation of duties (SOD_04): whoever requests a discount does not approve their own discount',
      );
    }

    if (!dto.approve && !dto.note?.trim()) {
      throw new BadRequestException('Refusing a discount requires a reason');
    }

    const updated = await this.prisma.discountRequest.update({
      where: { id },
      data: {
        status: dto.approve ? 'APPROVED' : 'REJECTED',
        decidedById: user.id,
        decidedAt: new Date(),
        decisionNote: dto.note,
      },
    });

    await this.audit.record({
      entityType: 'DiscountRequest',
      entityId: id,
      action: 'STATUS_CHANGE',
      userId: user.id,
      before: { status: 'PENDING' },
      after: { status: updated.status, note: dto.note ?? null },
    });

    return updated;
  }
}
