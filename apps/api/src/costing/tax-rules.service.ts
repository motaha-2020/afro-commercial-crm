import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  applicableTaxRules,
  type TaxBase,
  type TaxContext,
  type TaxRule as SharedTaxRule,
  type TaxType,
} from '@acms/shared';
import type { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CodeGeneratorService } from '../common/code-generator.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { ApproveTaxRuleDto, CreateTaxRuleDto } from './dto';

/**
 * Who may approve a tax rule.
 *
 * The same authority as a cost rule and for the same reason: a rate the person
 * pricing against it can also set is not a rate, it is a preference. Tax adds
 * a second reason — the number is the state's, not ours, so the only question
 * anyone here answers is whether it has been read correctly.
 */
const TAX_APPROVAL_AUTHORITY: Role[] = ['FINANCE', 'CEO', 'OWNER_BOARD'];

@Injectable()
export class TaxRulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly codes: CodeGeneratorService,
  ) {}

  async list(user: AuthenticatedUser, query: { country?: string; orgUnitId?: string }) {
    const rules = await this.prisma.taxRule.findMany({
      where: { deletedAt: null },
      orderBy: [{ taxType: 'asc' }, { effectiveFrom: 'desc' }],
      include: {
        createdBy: { select: { id: true, fullNameEn: true, fullNameAr: true } },
        approvedBy: { select: { id: true, fullNameEn: true, fullNameAr: true } },
      },
    });

    const ctx: TaxContext = { country: query.country, orgUnitId: query.orgUnitId };
    const inForce = new Set(
      applicableTaxRules(rules.map((r) => this.toShared(r)), ctx).map((r) => r.id),
    );

    return {
      rules: rules.map((r) => ({
        ...r,
        // Approved is not the same as applying: a group-wide VAT rule stays
        // approved while a country rule overrides it here.
        inForceHere: inForce.has(r.id),
      })),
      canApprove: this.mayApprove(user),
      scope: { country: query.country ?? null, orgUnitId: query.orgUnitId ?? null },
    };
  }

  async create(user: AuthenticatedUser, dto: CreateTaxRuleDto) {
    // Two rules of the same type on the same base in the same scope and period
    // is a question with two answers. Caught here rather than at computation
    // time, where the loser would simply vanish from the total.
    const overlapping = await this.prisma.taxRule.findFirst({
      where: {
        deletedAt: null,
        taxType: dto.taxType,
        base: dto.base,
        country: dto.country ?? null,
        orgUnitId: dto.orgUnitId ?? null,
        approvalStatus: { not: 'REJECTED' },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date(dto.effectiveFrom) } }],
      },
    });
    if (overlapping) {
      throw new BadRequestException({
        message:
          'A rule of this type already covers this base and scope for that period. Close the existing one first, or scope this one to a country.',
        conflictingRuleId: overlapping.id,
      });
    }

    const rule = await this.prisma.taxRule.create({
      data: {
        code: await this.codes.next('TAX', 'taxRule', new Date().getFullYear()),
        name: dto.name,
        taxType: dto.taxType,
        base: dto.base,
        ratePercent: dto.ratePercent,
        isRecoverable: dto.isRecoverable ?? false,
        country: dto.country,
        orgUnitId: dto.orgUnitId,
        effectiveFrom: new Date(dto.effectiveFrom),
        effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
        note: dto.note,
        createdById: user.id,
      },
    });

    await this.audit.record({
      entityType: 'TaxRule',
      entityId: rule.id,
      action: 'CREATE',
      userId: user.id,
      after: {
        taxType: dto.taxType,
        base: dto.base,
        ratePercent: dto.ratePercent,
        country: dto.country ?? null,
      },
    });

    return rule;
  }

  /**
   * Approve or reject.
   *
   * Whoever proposed the rate does not approve it — SoD's shape applied to the
   * one number nobody in the company chose. A rejection carries its reason,
   * because "rejected" without one leaves the next person to guess whether the
   * rate was wrong or merely early.
   */
  async decide(user: AuthenticatedUser, id: string, dto: ApproveTaxRuleDto) {
    if (!this.mayApprove(user)) {
      throw new ForbiddenException('Approving a tax rule is for Finance or executive management');
    }

    const rule = await this.ruleOr404(id);
    if (rule.approvalStatus !== 'DRAFT') {
      throw new BadRequestException(`This rule is already ${rule.approvalStatus}`);
    }
    if (rule.createdById === user.id) {
      throw new ForbiddenException(
        'Whoever proposed a tax rate does not approve it themselves',
      );
    }
    if (!dto.approve && !dto.rejectionReason) {
      throw new BadRequestException('A rejected rule needs its reason recorded');
    }

    const updated = await this.prisma.taxRule.update({
      where: { id },
      data: dto.approve
        ? { approvalStatus: 'APPROVED', approvedById: user.id, approvedAt: new Date() }
        : { approvalStatus: 'REJECTED', rejectionReason: dto.rejectionReason },
    });

    await this.audit.record({
      entityType: 'TaxRule',
      entityId: id,
      action: 'STATUS_CHANGE',
      userId: user.id,
      before: { approvalStatus: 'DRAFT' },
      after: {
        approvalStatus: updated.approvalStatus,
        rejectionReason: updated.rejectionReason ?? null,
      },
    });

    return updated;
  }

  async remove(user: AuthenticatedUser, id: string) {
    if (!this.mayApprove(user)) {
      throw new ForbiddenException('Removing a tax rule is for Finance or executive management');
    }
    const rule = await this.ruleOr404(id);

    // An approved rule has priced bids. It is closed by an end date so those
    // remain explainable, never removed as if it had not applied.
    if (rule.approvalStatus === 'APPROVED' && !rule.effectiveTo) {
      throw new BadRequestException(
        'An approved rule that is still open cannot be deleted — give it an end date, so costings priced under it stay explainable',
      );
    }

    await this.prisma.taxRule.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.record({
      entityType: 'TaxRule',
      entityId: id,
      action: 'SOFT_DELETE',
      userId: user.id,
      before: { taxType: rule.taxType, base: rule.base, ratePercent: rule.ratePercent.toString() },
    });

    return { success: true };
  }

  /** Every approved rule, for the costing screen to apply. */
  async allRules(): Promise<SharedTaxRule[]> {
    const rules = await this.prisma.taxRule.findMany({ where: { deletedAt: null } });
    return rules.map((r) => this.toShared(r));
  }

  private mayApprove(user: AuthenticatedUser) {
    return user.roles.some((r) => TAX_APPROVAL_AUTHORITY.includes(r.role as Role));
  }

  private async ruleOr404(id: string) {
    const rule = await this.prisma.taxRule.findFirst({ where: { id, deletedAt: null } });
    if (!rule) throw new NotFoundException('Tax rule not found');
    return rule;
  }

  private toShared(rule: {
    id: string;
    name: string;
    taxType: string;
    base: string;
    ratePercent: unknown;
    isRecoverable: boolean;
    country: string | null;
    orgUnitId: string | null;
    effectiveFrom: Date;
    effectiveTo: Date | null;
    approvalStatus: string;
  }): SharedTaxRule {
    return {
      id: rule.id,
      name: rule.name,
      taxType: rule.taxType as TaxType,
      base: rule.base as TaxBase,
      ratePercent: Number(rule.ratePercent),
      isRecoverable: rule.isRecoverable,
      country: rule.country,
      orgUnitId: rule.orgUnitId,
      effectiveFrom: rule.effectiveFrom,
      effectiveTo: rule.effectiveTo,
      approvalStatus: rule.approvalStatus as SharedTaxRule['approvalStatus'],
    };
  }
}
