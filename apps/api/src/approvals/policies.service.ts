import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  APPROVAL_POLICY_KEYS,
  policySnapshot,
  resolvePolicy,
  type ApprovalPolicyKey,
  type PolicyRow,
  type ResolveContext,
} from '@acms/shared';
import type { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { ListPoliciesQuery, SetPolicyDto } from './dto';

/**
 * Who may change a limit.
 *
 * Deliberately NOT the same list as who may approve deals against one. That
 * separation is the entire content of SOD_08, and collapsing the two lists
 * would quietly undo it: a sales director who can both approve a deal at their
 * ceiling and raise that ceiling has no ceiling.
 */
const POLICY_AUTHORITY: Role[] = ['CEO', 'OWNER_BOARD', 'FINANCE'];

@Injectable()
export class PoliciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Every limit currently in force for a scope, plus the ones nobody has set.
   *
   * Unconfigured keys are returned explicitly rather than omitted. A settings
   * screen that simply does not mention MIN_GROSS_MARGIN_PERCENT reads as "no
   * concern here"; one that says "not set" reads as "somebody must decide
   * this", which is the truth.
   */
  async effective(user: AuthenticatedUser, query: ListPoliciesQuery) {
    const rows = await this.load();
    const ctx: ResolveContext = {
      country: query.country,
      orgUnitId: query.orgUnitId,
      opportunityId: query.opportunityId,
      asOf: query.asOf ? new Date(query.asOf) : new Date(),
    };

    const keys = APPROVAL_POLICY_KEYS.map((key) => {
      const row = resolvePolicy(rows, key, ctx);
      return {
        key,
        value: row ? row.value : null,
        configured: row !== null,
        scope: row ? this.describeScope(row) : null,
        effectiveFrom: row?.effectiveFrom ?? null,
      };
    });

    return {
      scope: { country: query.country ?? null, orgUnitId: query.orgUnitId ?? null, opportunityId: query.opportunityId ?? null },
      asOf: ctx.asOf,
      keys,
      unconfigured: keys.filter((k) => !k.configured).map((k) => k.key),
      canEdit: this.mayEdit(user),
    };
  }

  /** The full history of a key, so a past decision stays explainable. */
  async history(user: AuthenticatedUser, key: ApprovalPolicyKey) {
    return this.prisma.approvalPolicy.findMany({
      where: { key, deletedAt: null },
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
      include: {
        createdBy: { select: { id: true, fullNameEn: true, fullNameAr: true } },
        orgUnit: { select: { id: true, code: true, nameEn: true } },
        opportunity: { select: { id: true, code: true, name: true } },
      },
    });
  }

  /**
   * Set a limit. A change is a new row that supersedes the old one rather than
   * an overwrite — the same treatment resource rates get, for the same reason:
   * an approval granted last month has to remain explainable with the number
   * that applied last month.
   */
  async set(user: AuthenticatedUser, dto: SetPolicyDto) {
    if (!this.mayEdit(user)) {
      await this.audit.record({
        entityType: 'ApprovalPolicy',
        entityId: dto.key,
        action: 'SOD_BLOCKED',
        userId: user.id,
        after: { rule: 'SOD_08', attemptedAction: 'APPROVAL_THRESHOLD_CHANGE', key: dto.key },
      });
      throw new ForbiddenException(
        'Segregation of duties (SOD_08): approval limits are not changed by the people who approve deals against them',
      );
    }

    this.assertSensible(dto);

    const effectiveFrom = dto.effectiveFrom ? new Date(dto.effectiveFrom) : new Date();

    // The row this one replaces, within the exact same scope.
    const previous = await this.prisma.approvalPolicy.findFirst({
      where: {
        key: dto.key,
        country: dto.country ?? null,
        orgUnitId: dto.orgUnitId ?? null,
        opportunityId: dto.opportunityId ?? null,
        effectiveTo: null,
        deletedAt: null,
      },
      orderBy: { effectiveFrom: 'desc' },
    });

    // Closing the old row and opening the new one must be one act: a gap
    // between them is a moment with no limit in force at all.
    const created = await this.prisma.$transaction(async (tx) => {
      if (previous) {
        await tx.approvalPolicy.update({
          where: { id: previous.id },
          data: { effectiveTo: effectiveFrom },
        });
      }
      return tx.approvalPolicy.create({
        data: {
          key: dto.key,
          value: dto.value,
          currency: dto.currency,
          country: dto.country,
          orgUnitId: dto.orgUnitId,
          opportunityId: dto.opportunityId,
          effectiveFrom,
          note: dto.note,
          createdById: user.id,
        },
      });
    });

    // Recorded with both numbers: "who raised the discount ceiling, and from
    // what" is the first question an auditor asks about a surprising approval.
    await this.audit.record({
      entityType: 'ApprovalPolicy',
      entityId: created.id,
      action: previous ? 'UPDATE' : 'CREATE',
      userId: user.id,
      before: previous ? { value: Number(previous.value) } : undefined,
      after: {
        key: dto.key,
        value: dto.value,
        scope: this.describeScope({
          country: dto.country ?? null,
          orgUnitId: dto.orgUnitId ?? null,
          opportunityId: dto.opportunityId ?? null,
        }),
        note: dto.note ?? null,
      },
    });

    return created;
  }

  async remove(user: AuthenticatedUser, id: string) {
    if (!this.mayEdit(user)) {
      throw new ForbiddenException(
        'Segregation of duties (SOD_08): approval limits are not changed by the people who approve deals against them',
      );
    }
    const row = await this.prisma.approvalPolicy.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundException('Policy not found');

    await this.prisma.approvalPolicy.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.record({
      entityType: 'ApprovalPolicy',
      entityId: id,
      action: 'SOFT_DELETE',
      userId: user.id,
      before: { key: row.key, value: Number(row.value) },
    });
    return { success: true };
  }

  // -------------------------------------------------------------------------
  // Used by the approvals engine
  // -------------------------------------------------------------------------

  async rowsFor(ctx: ResolveContext): Promise<PolicyRow[]> {
    const rows = await this.prisma.approvalPolicy.findMany({
      where: {
        deletedAt: null,
        OR: [
          { country: null, orgUnitId: null, opportunityId: null },
          { country: ctx.country ?? undefined },
          { orgUnitId: ctx.orgUnitId ?? undefined },
          { opportunityId: ctx.opportunityId ?? undefined },
        ],
      },
    });
    return rows.map((r) => this.toPolicyRow(r));
  }

  async snapshotFor(ctx: ResolveContext) {
    return policySnapshot(await this.rowsFor(ctx), ctx);
  }

  async valueOf(key: ApprovalPolicyKey, ctx: ResolveContext): Promise<number | null> {
    const row = resolvePolicy(await this.rowsFor(ctx), key, ctx);
    return row ? row.value : null;
  }

  // -------------------------------------------------------------------------

  /** All live rows; resolution against a scope happens in @acms/shared. */
  private async load(): Promise<PolicyRow[]> {
    const rows = await this.prisma.approvalPolicy.findMany({ where: { deletedAt: null } });
    return rows.map((r) => this.toPolicyRow(r));
  }

  private toPolicyRow(r: {
    key: string;
    value: unknown;
    country: string | null;
    orgUnitId: string | null;
    opportunityId: string | null;
    effectiveFrom: Date;
    effectiveTo: Date | null;
  }): PolicyRow {
    return {
      key: r.key as ApprovalPolicyKey,
      value: Number(r.value),
      country: r.country,
      orgUnitId: r.orgUnitId,
      opportunityId: r.opportunityId,
      effectiveFrom: r.effectiveFrom,
      effectiveTo: r.effectiveTo,
    };
  }

  private mayEdit(user: AuthenticatedUser) {
    return user.roles.some((r) => POLICY_AUTHORITY.includes(r.role));
  }

  private describeScope(row: {
    country?: string | null;
    orgUnitId?: string | null;
    opportunityId?: string | null;
  }) {
    if (row.opportunityId) return { level: 'OPPORTUNITY', id: row.opportunityId };
    if (row.orgUnitId) return { level: 'BUSINESS_UNIT', id: row.orgUnitId };
    if (row.country) return { level: 'COUNTRY', id: row.country };
    return { level: 'GROUP', id: null };
  }

  /**
   * Guards against numbers that are typos rather than policy. Percentages are
   * checked because a margin floor of 1200 would let every deal through
   * silently, which is worse than the setting being rejected.
   */
  private assertSensible(dto: SetPolicyDto) {
    const percentKeys: string[] = [
      'MIN_GROSS_MARGIN_PERCENT',
      'MIN_SELLING_PRICE_MARGIN_PERCENT',
      'MAX_DISCOUNT_PERCENT',
      'BID_GO_THRESHOLD',
      'BID_CONDITIONAL_THRESHOLD',
    ];
    if (percentKeys.includes(dto.key) && (dto.value < 0 || dto.value > 100)) {
      throw new BadRequestException(`${dto.key} is a percentage and must be between 0 and 100`);
    }
    if (dto.value < 0) {
      throw new BadRequestException('A limit cannot be negative');
    }
  }
}
