import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { AI_APPROVER_ROLES } from './approver-roles';

export interface CreateSuggestionInput {
  conversationId?: string;
  agentKey: string;
  entityType: string;
  entityId?: string;
  originalData?: Prisma.InputJsonValue;
  recommendation: Prisma.InputJsonValue;
  suggestedChange?: Prisma.InputJsonValue;
  confidenceScore: number;
}

/**
 * The Compliance & Approval gate every agent action passes through before it
 * touches real data — this is the "Human in the Loop" box in the
 * architecture, sitting between an agent's recommendation and its execution.
 * No agent calls Prisma to change a record directly; it calls `create()`
 * here and waits for `approve()`.
 */
@Injectable()
export class AiSuggestionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(userId: string, input: CreateSuggestionInput) {
    const suggestion = await this.prisma.aiSuggestion.create({
      data: {
        conversationId: input.conversationId,
        agentKey: input.agentKey,
        entityType: input.entityType,
        entityId: input.entityId,
        userId,
        originalData: input.originalData,
        recommendation: input.recommendation,
        suggestedChange: input.suggestedChange,
        confidenceScore: input.confidenceScore,
      },
    });

    await this.audit.record({
      entityType: 'AiSuggestion',
      entityId: suggestion.id,
      action: 'CREATE',
      userId,
      after: {
        agentKey: input.agentKey,
        targetEntityType: input.entityType,
        targetEntityId: input.entityId,
        confidenceScore: input.confidenceScore,
      },
    });

    return suggestion;
  }

  listPending(user: AuthenticatedUser) {
    this.assertCanApprove(user);
    return this.prisma.aiSuggestion.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
    });
  }

  async approve(id: string, approver: AuthenticatedUser) {
    this.assertCanApprove(approver);
    const suggestion = await this.mustFindPending(id);

    const updated = await this.prisma.aiSuggestion.update({
      where: { id },
      data: {
        status: 'APPROVED',
        approverId: approver.id,
        approvedAt: new Date(),
      },
    });

    await this.audit.record({
      entityType: 'AiSuggestion',
      entityId: id,
      action: 'STATUS_CHANGE',
      userId: approver.id,
      before: { status: suggestion.status },
      after: { status: 'APPROVED' },
    });

    return updated;
  }

  async reject(id: string, approver: AuthenticatedUser, reason: string) {
    this.assertCanApprove(approver);
    const suggestion = await this.mustFindPending(id);

    const updated = await this.prisma.aiSuggestion.update({
      where: { id },
      data: {
        status: 'REJECTED',
        approverId: approver.id,
        approvedAt: new Date(),
        rejectionReason: reason,
      },
    });

    await this.audit.record({
      entityType: 'AiSuggestion',
      entityId: id,
      action: 'STATUS_CHANGE',
      userId: approver.id,
      before: { status: suggestion.status },
      after: { status: 'REJECTED', reason },
    });

    return updated;
  }

  /**
   * Called by an agent's executor after `approve()`, once it has actually
   * applied the change to the target entity. Kept separate from `approve()`
   * because approval and execution can fail independently and the audit
   * trail should show both moments.
   */
  async markExecuted(id: string, outcome: { ok: boolean; error?: string }) {
    await this.prisma.aiSuggestion.update({
      where: { id },
      data: {
        status: outcome.ok ? 'EXECUTED' : 'FAILED',
        executionStatus: outcome.ok ? 'DONE' : 'ERROR',
        executionError: outcome.error,
        executedAt: new Date(),
      },
    });
  }

  private async mustFindPending(id: string) {
    const suggestion = await this.prisma.aiSuggestion.findUnique({ where: { id } });
    if (!suggestion) throw new NotFoundException('AI suggestion not found');
    if (suggestion.status !== 'PENDING') {
      throw new ForbiddenException(`Suggestion is already "${suggestion.status}"`);
    }
    return suggestion;
  }

  private assertCanApprove(user: AuthenticatedUser) {
    const canApprove = user.roles.some((r) => AI_APPROVER_ROLES.includes(r.role));
    if (!canApprove) {
      throw new ForbiddenException('This role cannot approve AI suggestions');
    }
  }
}
