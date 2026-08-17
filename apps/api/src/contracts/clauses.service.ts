import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { clauseNeedsMitigation, type RiskLevel } from '@acms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OpportunityAccessService } from '../common/opportunity-access.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { AddClauseDto, ApproveClauseDto, UpdateClauseDto } from './dto';

/**
 * The clause register for a contract.
 *
 * Distinct from {@link ContractDeviation}, which answers "how does this differ
 * from what we offered?". A clause register answers a different question — what
 * does this contract actually say, and who inside Afro carries each part of it.
 * A punitive term that was in the tender from day one differs from nothing and
 * would never appear as a deviation, but it is exactly what somebody needs to
 * find eighteen months later.
 */
@Injectable()
export class ClausesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly opportunities: OpportunityAccessService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(user: AuthenticatedUser, contractId: string) {
    const contract = await this.assertContract(user, contractId);

    const items = await this.prisma.contractClause.findMany({
      where: { contractId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });

    // Unsigned first, then riskiest. A register read top to bottom should open
    // where the attention is still owed — the enum's declaration order in the
    // database is alphabetical and would put CRITICAL below HIGH.
    const ordered = [...items].sort(
      (a, b) =>
        Number(a.isApproved) - Number(b.isApproved) ||
        RISK_ORDER[b.riskLevel as RiskLevel] - RISK_ORDER[a.riskLevel as RiskLevel],
    );

    return {
      items: ordered,
      total: ordered.length,
      contract: {
        id: contract.id,
        code: contract.code,
        contractNumber: contract.contractNumber,
        opportunityId: contract.opportunityId,
      },
      /**
       * Counted here rather than on the screen, so every caller reads the same
       * number. An unapproved high-risk clause is the one fact this register
       * exists to surface.
       */
      unapprovedHighRisk: ordered.filter(
        (c) => !c.isApproved && clauseNeedsMitigation(c.riskLevel as RiskLevel),
      ).length,
    };
  }

  async add(user: AuthenticatedUser, contractId: string, dto: AddClauseDto) {
    await this.assertContract(user, contractId);

    const clause = await this.prisma.contractClause.create({
      data: {
        contractId,
        clauseType: dto.clauseType,
        clauseText: dto.clauseText,
        riskLevel: (dto.riskLevel ?? 'MEDIUM') as never,
        owner: dto.owner,
        mitigation: dto.mitigation,
        // Never approved on the way in, whoever is typing. Approval is an act
        // with a name and a time against it, not a default.
        isApproved: false,
      },
    });

    await this.audit.record({
      entityType: 'ContractClause',
      entityId: clause.id,
      action: 'CREATE',
      userId: user.id,
      after: {
        contractId,
        clauseType: dto.clauseType,
        riskLevel: clause.riskLevel,
      },
    });

    await this.notifyIfCritical(clause.id, clause.clauseType, clause.riskLevel as RiskLevel);

    return clause;
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateClauseDto) {
    const existing = await this.findAccessible(user, id);

    // Changing the words re-opens the sign-off. An approval is approval of a
    // specific text; letting the text move underneath it would leave the
    // register asserting that somebody approved wording they never read.
    const textChanged =
      dto.clauseText !== undefined && dto.clauseText !== existing.clauseText;
    const riskChanged =
      dto.riskLevel !== undefined && dto.riskLevel !== existing.riskLevel;
    const reopen = existing.isApproved && (textChanged || riskChanged);

    const updated = await this.prisma.contractClause.update({
      where: { id },
      data: {
        clauseType: dto.clauseType,
        clauseText: dto.clauseText,
        riskLevel: dto.riskLevel as never,
        owner: dto.owner,
        mitigation: dto.mitigation,
        ...(reopen ? { isApproved: false } : {}),
      },
    });

    await this.audit.recordUpdate(
      'ContractClause',
      id,
      existing as unknown as Record<string, unknown>,
      updated as unknown as Record<string, unknown>,
      user.id,
    );

    if (riskChanged) {
      await this.notifyIfCritical(id, updated.clauseType, updated.riskLevel as RiskLevel);
    }

    return { ...updated, reopenedForApproval: reopen };
  }

  /**
   * Sign-off, deliberately its own endpoint and its own audit entry.
   *
   * Above medium risk it will not proceed on an empty mitigation: what we
   * intend to do about an uncapped liability is the only part of the record
   * anyone will want when the clause is invoked, and "approved" on its own
   * does not say it.
   */
  async approve(user: AuthenticatedUser, id: string, dto: ApproveClauseDto) {
    const existing = await this.findAccessible(user, id);

    const mitigation = dto.mitigation ?? existing.mitigation ?? null;
    if (clauseNeedsMitigation(existing.riskLevel as RiskLevel) && !mitigation?.trim()) {
      throw new BadRequestException(
        `A ${existing.riskLevel} clause needs a written mitigation before it can be approved`,
      );
    }

    if (existing.isApproved) {
      throw new BadRequestException('Clause is already approved');
    }

    const updated = await this.prisma.contractClause.update({
      where: { id },
      data: { isApproved: true, mitigation },
    });

    await this.audit.record({
      entityType: 'ContractClause',
      entityId: id,
      action: 'STATUS_CHANGE',
      userId: user.id,
      after: {
        clauseType: existing.clauseType,
        riskLevel: existing.riskLevel,
        mitigation,
      },
    });

    return updated;
  }

  async remove(user: AuthenticatedUser, id: string) {
    const existing = await this.findAccessible(user, id);

    await this.prisma.contractClause.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await this.audit.record({
      entityType: 'ContractClause',
      entityId: id,
      action: 'SOFT_DELETE',
      userId: user.id,
      before: {
        contractId: existing.contractId,
        clauseType: existing.clauseType,
        riskLevel: existing.riskLevel,
        wasApproved: existing.isApproved,
      },
    });

    return { success: true };
  }

  /**
   * A clause has no scope of its own: it inherits the contract's, which
   * inherits the opportunity's. Absent and out-of-scope both answer 404.
   */
  private async assertContract(user: AuthenticatedUser, contractId: string) {
    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, deletedAt: null },
      select: {
        id: true,
        code: true,
        contractNumber: true,
        opportunityId: true,
      },
    });
    if (!contract) throw new NotFoundException('Contract not found');
    await this.opportunities.assert(user, contract.opportunityId);
    return contract;
  }

  private async findAccessible(user: AuthenticatedUser, id: string) {
    const clause = await this.prisma.contractClause.findFirst({
      where: { id, deletedAt: null },
    });
    if (!clause) throw new NotFoundException('Clause not found');
    await this.assertContract(user, clause.contractId);
    return clause;
  }

  /**
   * Reuses the deviation module's critical event rather than minting a second
   * one: for whoever receives it, an uncapped liability found in the clause
   * register and the same thing found by the deviation engine are the same
   * piece of news.
   */
  private async notifyIfCritical(id: string, clauseType: string, risk: RiskLevel) {
    if (risk !== 'CRITICAL') return;
    await this.notifications.dispatchEvent('CONTRACT_DEVIATION_CRITICAL', {
      title: `Critical contract clause: ${clauseType}`,
      body: 'Registered as critical and not yet approved — it needs a written mitigation before sign-off',
      entityType: 'ContractClause',
      entityId: id,
    });
  }
}

/** Ordering only; the risk ladder itself lives in `@acms/shared`. */
const RISK_ORDER: Record<RiskLevel, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};
