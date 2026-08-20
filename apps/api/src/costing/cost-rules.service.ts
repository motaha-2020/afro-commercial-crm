import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  applicableRules,
  type CostRule as SharedCostRule,
  type CostRuleCategory,
  type CostRuleContext,
  type CostRuleMethod,
} from '@acms/shared';
import type { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OpportunityAccessService } from '../common/opportunity-access.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { ApproveCostRuleDto, CreateCostRuleDto } from './dto';

/**
 * Who may approve a cost rule.
 *
 * Finance and executive management only, and deliberately not the estimators
 * who build costings against these rules — an overhead rate the person using
 * it can also set is not a rate, it is a preference.
 */
const RULE_APPROVAL_AUTHORITY: Role[] = ['FINANCE', 'CEO', 'OWNER_BOARD'];

@Injectable()
export class CostRulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly opportunities: OpportunityAccessService,
  ) {}

  async list(
    user: AuthenticatedUser,
    query: { country?: string; orgUnitId?: string; opportunityId?: string },
  ) {
    const rules = await this.prisma.costRule.findMany({
      where: { deletedAt: null },
      orderBy: [{ category: 'asc' }, { effectiveFrom: 'desc' }],
      include: {
        createdBy: { select: { id: true, fullNameEn: true, fullNameAr: true } },
        approvedBy: { select: { id: true, fullNameEn: true, fullNameAr: true } },
        orgUnit: { select: { id: true, code: true, nameEn: true } },
        // The code, so a rule scoped to one bid names it on screen. An id
        // would be an identifier the reader cannot act on.
        opportunity: { select: { id: true, code: true, name: true } },
      },
    });

    const ctx: CostRuleContext = {
      country: query.country,
      orgUnitId: query.orgUnitId,
      opportunityId: query.opportunityId,
    };
    const inForce = new Set(
      applicableRules(rules.map((r) => this.toShared(r)), ctx).map((r) => r.id),
    );

    return {
      rules: rules.map((r) => ({
        ...r,
        // Approved is not the same as applying: a country rule can be approved
        // and still be overridden by a narrower one.
        inForceHere: inForce.has(r.id),
      })),
      canApprove: this.mayApprove(user),
      scope: {
        country: query.country ?? null,
        orgUnitId: query.orgUnitId ?? null,
        opportunityId: query.opportunityId ?? null,
      },
    };
  }

  async create(user: AuthenticatedUser, dto: CreateCostRuleDto) {
    this.assertSensible(dto);

    // Resolved through the caller's own visibility: a code they cannot see
    // resolves to nothing, so a rule can neither attach itself to somebody
    // else's deal nor confirm that the deal exists.
    const opportunityId = dto.opportunityCode
      ? await this.resolveOpportunity(user, dto.opportunityCode)
      : undefined;

    const rule = await this.prisma.costRule.create({
      data: {
        code: await this.nextCode(),
        name: dto.name,
        category: dto.category as never,
        method: dto.method as never,
        value: dto.value,
        currency: dto.currency,
        country: dto.country,
        orgUnitId: dto.orgUnitId,
        opportunityId,
        effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : new Date(),
        effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
        note: dto.note,
        createdById: user.id,
        // Always drafted, whoever creates it. A rule that arrived approved
        // because a finance director happened to type it would make the
        // approval step a formality of who is at the keyboard.
        approvalStatus: 'DRAFT',
      },
    });

    await this.audit.record({
      entityType: 'CostRule',
      entityId: rule.id,
      action: 'CREATE',
      userId: user.id,
      after: { name: dto.name, category: dto.category, method: dto.method, value: dto.value },
    });

    return rule;
  }

  /**
   * Approve or reject a rule.
   *
   * Separate from creating it, and reserved to finance: the spec's principle
   * for tax rules governs overheads too — the system applies rules Finance has
   * approved rather than deciding treatment itself.
   */
  async decide(user: AuthenticatedUser, id: string, dto: ApproveCostRuleDto) {
    if (!this.mayApprove(user)) {
      await this.audit.record({
        entityType: 'CostRule',
        entityId: id,
        action: 'SOD_BLOCKED',
        userId: user.id,
        after: { attemptedAction: 'COST_RULE_APPROVE' },
      });
      throw new ForbiddenException(
        'Only finance or executive management may approve a cost rule',
      );
    }

    const rule = await this.prisma.costRule.findFirst({ where: { id, deletedAt: null } });
    if (!rule) throw new NotFoundException('Cost rule not found');
    if (rule.approvalStatus !== 'DRAFT') {
      throw new BadRequestException(`This rule is already ${rule.approvalStatus}`);
    }
    if (!dto.approve && !dto.reason?.trim()) {
      throw new BadRequestException('Rejecting a cost rule requires a reason');
    }

    const updated = await this.prisma.costRule.update({
      where: { id },
      data: {
        approvalStatus: dto.approve ? 'APPROVED' : 'REJECTED',
        approvedById: user.id,
        approvedAt: new Date(),
        rejectionReason: dto.approve ? null : dto.reason,
      },
    });

    await this.audit.record({
      entityType: 'CostRule',
      entityId: id,
      action: 'STATUS_CHANGE',
      userId: user.id,
      before: { approvalStatus: 'DRAFT' },
      after: {
        approvalStatus: updated.approvalStatus,
        // Recorded with the number, because approving a rule is approving what
        // it will add to every bid in its scope.
        value: Number(rule.value),
        category: rule.category,
        reason: dto.reason ?? null,
      },
    });

    return updated;
  }

  async remove(user: AuthenticatedUser, id: string) {
    if (!this.mayApprove(user)) {
      throw new ForbiddenException('Only finance or executive management may retire a cost rule');
    }
    const rule = await this.prisma.costRule.findFirst({ where: { id, deletedAt: null } });
    if (!rule) throw new NotFoundException('Cost rule not found');

    await this.prisma.costRule.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.record({
      entityType: 'CostRule',
      entityId: id,
      action: 'SOFT_DELETE',
      userId: user.id,
      before: { name: rule.name, value: Number(rule.value) },
    });
    return { success: true };
  }

  /** A bid code becomes an id only here, and only within what the user sees. */
  private async resolveOpportunity(user: AuthenticatedUser, code: string): Promise<string> {
    const trimmed = code.trim().toUpperCase();
    const opportunity = await this.prisma.opportunity.findFirst({
      where: { code: trimmed, deletedAt: null },
      select: { id: true },
    });
    if (!opportunity) {
      throw new BadRequestException(`No opportunity with code ${trimmed}`);
    }
    // Visibility is decided by the same gate every child of an opportunity
    // passes through, not by this query.
    await this.opportunities.assert(user, opportunity.id);
    return opportunity.id;
  }

  /** Every live rule, for the costing service to apply. */
  async allRules(): Promise<SharedCostRule[]> {
    const rules = await this.prisma.costRule.findMany({ where: { deletedAt: null } });
    return rules.map((r) => this.toShared(r));
  }

  // -------------------------------------------------------------------------

  private toShared(r: {
    id: string;
    name: string;
    category: string;
    method: string;
    value: unknown;
    country: string | null;
    orgUnitId: string | null;
    opportunityId: string | null;
    effectiveFrom: Date;
    effectiveTo: Date | null;
    approvalStatus: string;
  }): SharedCostRule {
    return {
      id: r.id,
      name: r.name,
      category: r.category as CostRuleCategory,
      method: r.method as CostRuleMethod,
      value: Number(r.value),
      country: r.country,
      orgUnitId: r.orgUnitId,
      // Dropping this here would silently disable the whole precedence: every
      // per-bid rule would read as a group rule and apply to every bid.
      opportunityId: r.opportunityId,
      effectiveFrom: r.effectiveFrom,
      effectiveTo: r.effectiveTo,
      approvalStatus: r.approvalStatus as SharedCostRule['approvalStatus'],
    };
  }

  private mayApprove(user: AuthenticatedUser) {
    return user.roles.some((r) => RULE_APPROVAL_AUTHORITY.includes(r.role));
  }

  private async nextCode() {
    const count = await this.prisma.costRule.count();
    return `CR-${String(count + 1).padStart(4, '0')}`;
  }

  /**
   * Catches the typo that would otherwise be approved and then applied to
   * every bid in scope. A 1200% G&A is not a policy anyone meant.
   */
  private assertSensible(dto: CreateCostRuleDto) {
    if (dto.value < 0) throw new BadRequestException('A cost rule cannot be negative');

    const isPercent =
      dto.method === 'PERCENT_OF_DIRECT_COST' || dto.method === 'PERCENT_OF_REVENUE';
    if (isPercent && dto.value > 100) {
      throw new BadRequestException(
        `${dto.method} is a percentage and must be between 0 and 100`,
      );
    }
    if (dto.effectiveTo && dto.effectiveFrom && dto.effectiveTo <= dto.effectiveFrom) {
      throw new BadRequestException('A rule cannot expire before it takes effect');
    }
  }
}
