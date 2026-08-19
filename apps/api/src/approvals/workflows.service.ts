import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type {
  CreateRuleDto,
  CreateWorkflowDto,
  CreateWorkflowStepDto,
  UpdateRuleDto,
  UpdateWorkflowDto,
  UpdateWorkflowStepDto,
} from './dto';

/**
 * Who may edit an approval workflow.
 *
 * The same three roles that may move a limit, and for the same reason: a step
 * removed is a limit lifted. Letting a sales director delete the step that
 * approves their own deals would undo SOD_08 by a different route than raising
 * the threshold, and the rule is about the ceiling, not about the mechanism
 * used to remove it.
 */
const WORKFLOW_AUTHORITY: Role[] = ['CEO', 'OWNER_BOARD', 'FINANCE'];

@Injectable()
export class WorkflowsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private assertAuthority(user: AuthenticatedUser) {
    const held = user.roles.map((r) => r.role as Role);
    if (!held.some((r) => WORKFLOW_AUTHORITY.includes(r))) {
      throw new ForbiddenException(
        'Editing an approval workflow is restricted to the roles that own the approval limits',
      );
    }
  }

  /**
   * Every workflow with its steps and rules, ordered as they run.
   *
   * Soft-deleted steps and rules are excluded, but INACTIVE ones are returned:
   * a rule switched off is a decision somebody made and may need to reverse,
   * while a rule that has vanished cannot be reasoned about at all.
   */
  async list(user: AuthenticatedUser) {
    this.assertAuthority(user);

    const workflows = await this.prisma.workflowDefinition.findMany({
      where: { deletedAt: null },
      orderBy: [{ businessProcess: 'asc' }, { createdAt: 'asc' }],
      include: {
        steps: {
          where: { deletedAt: null },
          orderBy: { sequence: 'asc' },
        },
        rules: {
          where: { deletedAt: null },
          orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
        },
      },
    });

    // How many requests are riding on each workflow right now. A screen that
    // offers "delete" without saying twelve deals are waiting on this step is
    // inviting somebody to strand them.
    const pending = await this.prisma.approvalRequest.groupBy({
      by: ['workflowId'],
      where: { status: 'PENDING' },
      _count: { _all: true },
    });
    const pendingBy = new Map(pending.map((p) => [p.workflowId, p._count._all]));

    return {
      workflows: workflows.map((w) => ({ ...w, pendingRequests: pendingBy.get(w.id) ?? 0 })),
    };
  }

  async create(user: AuthenticatedUser, dto: CreateWorkflowDto) {
    this.assertAuthority(user);

    const workflow = await this.prisma.workflowDefinition.create({
      data: {
        code: dto.code,
        name: dto.name,
        businessProcess: dto.businessProcess,
        country: dto.country,
        orgUnitId: dto.orgUnitId,
      },
    });

    await this.audit.record({
      entityType: 'WorkflowDefinition',
      entityId: workflow.id,
      action: 'CREATE',
      userId: user.id,
      after: { code: dto.code, businessProcess: dto.businessProcess, country: dto.country ?? null },
    });

    return workflow;
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateWorkflowDto) {
    this.assertAuthority(user);
    const before = await this.workflowOr404(id);

    // Switching a workflow off while deals are queued on it leaves them with
    // no route to a decision, which reads to their owners as the system
    // losing them.
    if (dto.isActive === false) {
      const pending = await this.prisma.approvalRequest.count({
        where: { workflowId: id, status: 'PENDING' },
      });
      if (pending > 0) {
        throw new BadRequestException({
          message:
            'This workflow cannot be switched off while approval requests are waiting on it. Decide them first.',
          pendingRequests: pending,
        });
      }
    }

    const updated = await this.prisma.workflowDefinition.update({
      where: { id },
      data: { name: dto.name, isActive: dto.isActive, country: dto.country },
    });

    await this.audit.record({
      entityType: 'WorkflowDefinition',
      entityId: id,
      action: 'UPDATE',
      userId: user.id,
      before: { name: before.name, isActive: before.isActive, country: before.country },
      after: { name: updated.name, isActive: updated.isActive, country: updated.country },
    });

    return updated;
  }

  // --- steps -----------------------------------------------------------------

  async addStep(user: AuthenticatedUser, workflowId: string, dto: CreateWorkflowStepDto) {
    this.assertAuthority(user);
    await this.workflowOr404(workflowId);

    const clash = await this.prisma.workflowStep.findFirst({
      where: { workflowId, sequence: dto.sequence, deletedAt: null },
    });
    if (clash) {
      throw new BadRequestException(
        `Step ${dto.sequence} already exists in this workflow. Two steps at the same position have no defined order.`,
      );
    }

    const step = await this.prisma.workflowStep.create({
      data: {
        workflowId,
        sequence: dto.sequence,
        name: dto.name,
        approverRole: dto.approverRole,
        approvalType: dto.approvalType ?? 'SINGLE',
        slaHours: dto.slaHours,
        isMandatory: dto.isMandatory ?? true,
        escalationRole: dto.escalationRole,
      },
    });

    await this.audit.record({
      entityType: 'WorkflowStep',
      entityId: step.id,
      action: 'CREATE',
      userId: user.id,
      after: { workflowId, sequence: dto.sequence, approverRole: dto.approverRole },
    });

    return step;
  }

  async updateStep(user: AuthenticatedUser, id: string, dto: UpdateWorkflowStepDto) {
    this.assertAuthority(user);
    const before = await this.stepOr404(id);

    if (dto.sequence !== undefined && dto.sequence !== before.sequence) {
      const clash = await this.prisma.workflowStep.findFirst({
        where: {
          workflowId: before.workflowId,
          sequence: dto.sequence,
          deletedAt: null,
          NOT: { id },
        },
      });
      if (clash) {
        throw new BadRequestException(`Step ${dto.sequence} already exists in this workflow`);
      }
    }

    const updated = await this.prisma.workflowStep.update({
      where: { id },
      data: {
        sequence: dto.sequence,
        name: dto.name,
        approverRole: dto.approverRole,
        approvalType: dto.approvalType,
        slaHours: dto.slaHours,
        isMandatory: dto.isMandatory,
        escalationRole: dto.escalationRole,
      },
    });

    await this.audit.record({
      entityType: 'WorkflowStep',
      entityId: id,
      action: 'UPDATE',
      userId: user.id,
      before: {
        sequence: before.sequence,
        approverRole: before.approverRole,
        approvalType: before.approvalType,
      },
      after: {
        sequence: updated.sequence,
        approverRole: updated.approverRole,
        approvalType: updated.approvalType,
      },
    });

    return updated;
  }

  /**
   * Remove a step.
   *
   * Refused while a request is sitting on it: the request points at this step,
   * and deleting it leaves a deal waiting on an approver that no longer exists
   * — the failure would be silent and would surface as "why has nobody
   * approved this?" weeks later.
   *
   * Also refused when it is the last step: a workflow with no steps does not
   * approve nothing, it approves EVERYTHING, since there is no gate left to
   * pass. Switch the workflow off instead, which says what was meant.
   */
  async removeStep(user: AuthenticatedUser, id: string) {
    this.assertAuthority(user);
    const step = await this.stepOr404(id);

    const waiting = await this.prisma.approvalRequest.count({
      where: { currentStepId: id, status: 'PENDING' },
    });
    if (waiting > 0) {
      throw new BadRequestException({
        message: 'Approval requests are waiting on this step. Decide them before removing it.',
        pendingRequests: waiting,
      });
    }

    const remaining = await this.prisma.workflowStep.count({
      where: { workflowId: step.workflowId, deletedAt: null, NOT: { id } },
    });
    if (remaining === 0) {
      throw new BadRequestException(
        'A workflow cannot be left with no steps — that approves everything rather than nothing. Deactivate the workflow instead.',
      );
    }

    await this.prisma.workflowStep.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.record({
      entityType: 'WorkflowStep',
      entityId: id,
      action: 'SOFT_DELETE',
      userId: user.id,
      before: { sequence: step.sequence, approverRole: step.approverRole },
    });

    return { success: true };
  }

  // --- rules -----------------------------------------------------------------

  /**
   * A rule that fires an approval.
   *
   * Exactly one source for the number: a fixed threshold, or the policy key
   * whose current value to read. Both would leave two answers to one question,
   * and neither would leave a rule that can never fire — which is worse than
   * no rule, because it looks like a control on the governance screen.
   */
  async addRule(user: AuthenticatedUser, workflowId: string, dto: CreateRuleDto) {
    this.assertAuthority(user);
    await this.workflowOr404(workflowId);
    this.assertOneThresholdSource(dto);

    const rule = await this.prisma.approvalRule.create({
      data: {
        workflowId,
        conditionField: dto.conditionField,
        operator: dto.operator,
        threshold: dto.threshold,
        thresholdPolicyKey: dto.thresholdPolicyKey,
        requiredRole: dto.requiredRole,
        priority: dto.priority ?? 0,
        reason: dto.reason,
      },
    });

    await this.audit.record({
      entityType: 'ApprovalRule',
      entityId: rule.id,
      action: 'CREATE',
      userId: user.id,
      after: {
        workflowId,
        conditionField: dto.conditionField,
        operator: dto.operator,
        threshold: dto.threshold ?? null,
        thresholdPolicyKey: dto.thresholdPolicyKey ?? null,
        requiredRole: dto.requiredRole,
      },
    });

    return rule;
  }

  async updateRule(user: AuthenticatedUser, id: string, dto: UpdateRuleDto) {
    this.assertAuthority(user);
    const before = await this.ruleOr404(id);

    const merged = {
      threshold: dto.threshold ?? (dto.thresholdPolicyKey ? undefined : before.threshold),
      thresholdPolicyKey:
        dto.thresholdPolicyKey ?? (dto.threshold !== undefined ? undefined : before.thresholdPolicyKey),
    };
    this.assertOneThresholdSource({
      threshold: merged.threshold === null ? undefined : (merged.threshold as never),
      thresholdPolicyKey: merged.thresholdPolicyKey ?? undefined,
    });

    const updated = await this.prisma.approvalRule.update({
      where: { id },
      data: {
        conditionField: dto.conditionField,
        operator: dto.operator,
        threshold: dto.threshold,
        thresholdPolicyKey: dto.thresholdPolicyKey,
        requiredRole: dto.requiredRole,
        priority: dto.priority,
        isActive: dto.isActive,
        reason: dto.reason,
      },
    });

    await this.audit.record({
      entityType: 'ApprovalRule',
      entityId: id,
      action: 'UPDATE',
      userId: user.id,
      before: {
        threshold: before.threshold?.toString() ?? null,
        thresholdPolicyKey: before.thresholdPolicyKey,
        requiredRole: before.requiredRole,
        isActive: before.isActive,
      },
      after: {
        threshold: updated.threshold?.toString() ?? null,
        thresholdPolicyKey: updated.thresholdPolicyKey,
        requiredRole: updated.requiredRole,
        isActive: updated.isActive,
      },
    });

    return updated;
  }

  async removeRule(user: AuthenticatedUser, id: string) {
    this.assertAuthority(user);
    const rule = await this.ruleOr404(id);

    await this.prisma.approvalRule.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.record({
      entityType: 'ApprovalRule',
      entityId: id,
      action: 'SOFT_DELETE',
      userId: user.id,
      before: {
        conditionField: rule.conditionField,
        operator: rule.operator,
        requiredRole: rule.requiredRole,
      },
    });

    return { success: true };
  }

  private assertOneThresholdSource(dto: {
    threshold?: number;
    thresholdPolicyKey?: string;
    operator?: string;
    conditionField?: string;
  }) {
    const hasFixed = dto.threshold !== undefined && dto.threshold !== null;
    const hasKey = Boolean(dto.thresholdPolicyKey);

    // IS_TRUE asks a yes/no question — "is this a new country?" — and needs no
    // number at all. Demanding one there would be demanding a threshold for a
    // fact.
    if (dto.operator === 'IS_TRUE') return;

    if (hasFixed && hasKey) {
      throw new BadRequestException(
        'A rule reads its number from a fixed threshold OR from a policy key, never both',
      );
    }
    if (!hasFixed && !hasKey) {
      throw new BadRequestException(
        'A rule needs a number: either a fixed threshold or the policy key to read it from',
      );
    }
  }

  private async workflowOr404(id: string) {
    const row = await this.prisma.workflowDefinition.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundException('Workflow not found');
    return row;
  }

  private async stepOr404(id: string) {
    const row = await this.prisma.workflowStep.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundException('Workflow step not found');
    return row;
  }

  private async ruleOr404(id: string) {
    const row = await this.prisma.approvalRule.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundException('Approval rule not found');
    return row;
  }
}
