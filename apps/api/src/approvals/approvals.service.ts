import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  DECISION_OUTCOME,
  evaluateRules,
  isTerminalDecision,
  needsApproval,
  requiredApprovers,
  rollup,
  type ApprovalConditionField,
  type ApprovalDecision,
  type ApprovalOperator,
  type DealFacts,
  type RuleRow,
} from '@acms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CodeGeneratorService } from '../common/code-generator.service';
import { OpportunityAccessService } from '../common/opportunity-access.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PoliciesService } from './policies.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { DecideDto, RaiseApprovalDto } from './dto';

@Injectable()
export class ApprovalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly codes: CodeGeneratorService,
    private readonly opportunities: OpportunityAccessService,
    private readonly notifications: NotificationsService,
    private readonly policies: PoliciesService,
  ) {}

  /**
   * What this deal would need approved, without raising anything.
   *
   * Separate from raising the request on purpose: the spec's approval screen
   * has to show a manager *why* they are being asked, and a salesperson should
   * be able to see what they are about to trigger before they trigger it.
   */
  async preview(user: AuthenticatedUser, opportunityId: string) {
    const opportunity = await this.opportunities.assert(user, opportunityId);
    const facts = await this.gatherFacts(opportunityId);
    const { rules, workflow, ctx } = await this.rulesFor(opportunity);
    const policies = await this.policies.rowsFor(ctx);
    const evaluation = evaluateRules(rules, facts, policies, ctx);

    return {
      opportunityId,
      workflow: workflow ? { id: workflow.id, code: workflow.code, name: workflow.name } : null,
      facts,
      fired: evaluation.fired,
      undetermined: evaluation.undetermined,
      requiredApprovers: requiredApprovers(evaluation),
      needsApproval: needsApproval(evaluation),
      policySnapshot: await this.policies.snapshotFor(ctx),
    };
  }

  /**
   * Raise the approval this deal needs.
   *
   * The thresholds in force are snapshotted onto the request. Editing a policy
   * tomorrow must not rewrite what an approver was asked to judge today — the
   * same reason an approved costing version keeps its own totals.
   */
  async raise(user: AuthenticatedUser, opportunityId: string, dto: RaiseApprovalDto) {
    const opportunity = await this.opportunities.assert(user, opportunityId);
    const facts = await this.gatherFacts(opportunityId);
    const { rules, workflow, ctx } = await this.rulesFor(opportunity);

    if (!workflow) {
      throw new BadRequestException(
        'No approval workflow is configured for this process, country or business unit. Configure one in settings before requesting approval.',
      );
    }

    const policies = await this.policies.rowsFor(ctx);
    const evaluation = evaluateRules(rules, facts, policies, ctx);

    if (!needsApproval(evaluation)) {
      throw new BadRequestException({
        message: 'This deal is inside every configured limit and needs no approval',
        facts,
      });
    }

    const existing = await this.prisma.approvalRequest.findFirst({
      where: {
        recordType: dto.recordType ?? 'Opportunity',
        recordId: dto.recordId ?? opportunityId,
        status: 'PENDING',
        deletedAt: null,
      },
    });
    if (existing) {
      throw new BadRequestException('An approval for this record is already pending');
    }

    const steps = await this.applicableSteps(workflow.id, requiredApprovers(evaluation));
    const firstStep = steps[0] ?? null;

    const request = await this.prisma.approvalRequest.create({
      data: {
        code: await this.codes.next('APR', 'approvalRequest', new Date().getFullYear()),
        workflowId: workflow.id,
        recordType: dto.recordType ?? 'Opportunity',
        recordId: dto.recordId ?? opportunityId,
        opportunityId,
        currentStepId: firstStep?.id ?? null,
        triggeredBy: {
          facts,
          fired: evaluation.fired,
          undetermined: evaluation.undetermined,
        } as unknown as Prisma.InputJsonObject,
        policySnapshot: (await this.policies.snapshotFor(ctx)) as Prisma.InputJsonObject,
        requestedById: user.id,
        dueAt: firstStep?.slaHours
          ? new Date(Date.now() + firstStep.slaHours * 3600_000)
          : null,
      },
    });

    await this.audit.record({
      entityType: 'ApprovalRequest',
      entityId: request.id,
      action: 'CREATE',
      userId: user.id,
      after: {
        opportunityId,
        requiredApprovers: requiredApprovers(evaluation),
        firedRules: evaluation.fired.length,
        undetermined: evaluation.undetermined.length,
      },
    });

    await this.notifications.dispatchEvent('APPROVAL_REQUESTED', {
      title: `Approval needed: ${opportunity.name}`,
      body: evaluation.fired.length
        ? evaluation.fired.map((f) => `${f.conditionField} ${f.operator} ${f.threshold}`).join(' • ')
        : 'Limits are not configured for this deal — a person must decide',
      entityType: 'ApprovalRequest',
      entityId: request.id,
    });

    return this.findOne(user, request.id);
  }

  /** The approver's queue. */
  async myQueue(user: AuthenticatedUser) {
    const roles = user.roles.map((r) => r.role as string);

    const rows = await this.prisma.approvalRequest.findMany({
      where: {
        status: 'PENDING',
        deletedAt: null,
        currentStep: { approverRole: { in: roles } },
      },
      orderBy: { requestedAt: 'asc' },
      include: {
        opportunity: { select: { id: true, code: true, name: true, currency: true, estimatedValue: true } },
        currentStep: true,
        requestedBy: { select: { id: true, fullNameEn: true, fullNameAr: true } },
      },
    });

    const now = Date.now();
    return rows.map((r) => ({
      ...r,
      // "Time waiting" is what makes a queue actionable; the spec asks for it
      // by name on the approvals screen.
      waitingHours: Math.round((now - r.requestedAt.getTime()) / 3600_000),
      isLate: r.dueAt ? r.dueAt.getTime() < now : false,
    }));
  }

  async findOne(user: AuthenticatedUser, id: string) {
    const request = await this.prisma.approvalRequest.findFirst({
      where: { id, deletedAt: null },
      include: {
        workflow: { include: { steps: { where: { deletedAt: null }, orderBy: { sequence: 'asc' } } } },
        currentStep: true,
        requestedBy: { select: { id: true, fullNameEn: true, fullNameAr: true } },
        opportunity: {
          select: { id: true, code: true, name: true, currency: true, estimatedValue: true, country: true },
        },
        actions: {
          where: { deletedAt: null },
          orderBy: { actionDate: 'asc' },
          include: { approver: { select: { id: true, fullNameEn: true, fullNameAr: true } }, step: true },
        },
      },
    });
    if (!request) throw new NotFoundException('Approval request not found');
    if (request.opportunityId) await this.opportunities.assert(user, request.opportunityId);
    return request;
  }

  /**
   * Record a decision.
   *
   * Two refusals here are the release's whole point. A user cannot approve
   * what they themselves requested (SOD_07) — holding several roles does not
   * dissolve that. And a rejection or a conditional approval must carry words:
   * the spec asks for "لا موافقات شفوية غير مسجلة" and a condition nobody wrote
   * down is not a condition.
   */
  async decide(user: AuthenticatedUser, id: string, dto: DecideDto) {
    const request = await this.findOne(user, id);

    if (request.status !== 'PENDING') {
      throw new BadRequestException(`This request is already ${request.status}`);
    }

    if (request.requestedById === user.id) {
      await this.audit.record({
        entityType: 'ApprovalRequest',
        entityId: id,
        action: 'SOD_BLOCKED',
        userId: user.id,
        after: { rule: 'SOD_07', attemptedAction: 'APPROVE' },
      });
      throw new ForbiddenException(
        'Segregation of duties (SOD_07): a user cannot approve a request they raised themselves, even holding several roles',
      );
    }

    const step = request.currentStep;
    if (step && !user.roles.some((r) => (r.role as string) === step.approverRole)) {
      throw new ForbiddenException(
        `This step requires ${step.approverRole}; your roles do not include it`,
      );
    }

    const decision = dto.decision as ApprovalDecision;

    if (decision === 'APPROVE_WITH_CONDITIONS' && !dto.conditions?.trim()) {
      throw new BadRequestException(
        'Approving with conditions requires the conditions to be written down',
      );
    }
    if (
      (decision === 'REJECT' || decision === 'RETURN_FOR_REVISION') &&
      !dto.comment?.trim()
    ) {
      throw new BadRequestException('Rejecting or returning a request requires a reason');
    }

    // Only the steps this deal actually needs, so a request that requires the
    // CEO is not also parked on two intermediate desks that no rule asked for.
    const required = (
      (request.triggeredBy as { fired?: { requiredRole: string }[] } | null)?.fired ?? []
    ).map((f) => f.requiredRole);
    const steps = step ? await this.applicableSteps(request.workflowId, required) : [];
    const nextStep = step ? (steps.find((s) => s.sequence > step.sequence) ?? null) : null;

    // An approval with a further mandatory step is not yet an approval.
    const advances = decision === 'APPROVE' && nextStep !== null;
    const status = advances
      ? 'PENDING'
      : (DECISION_OUTCOME[decision] as
          | 'APPROVED'
          | 'REJECTED'
          | 'RETURNED_FOR_REVISION'
          | 'APPROVED_WITH_CONDITIONS');

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.approvalAction.create({
        data: {
          requestId: id,
          stepId: step?.id ?? null,
          approverId: user.id,
          decision,
          comment: dto.comment,
          conditions: dto.conditions,
        },
      });

      return tx.approvalRequest.update({
        where: { id },
        data: {
          status,
          currentStepId: advances ? nextStep!.id : step?.id ?? null,
          decidedAt: isTerminalDecision(decision) && !advances ? new Date() : null,
          dueAt:
            advances && nextStep?.slaHours
              ? new Date(Date.now() + nextStep.slaHours * 3600_000)
              : request.dueAt,
        },
      });
    });

    await this.audit.record({
      entityType: 'ApprovalRequest',
      entityId: id,
      action: 'STATUS_CHANGE',
      userId: user.id,
      before: { status: 'PENDING', step: step?.name ?? null },
      after: {
        status,
        decision,
        comment: dto.comment ?? null,
        conditions: dto.conditions ?? null,
        advancedTo: advances ? nextStep!.name : null,
      },
    });

    await this.notifications.dispatchEvent('APPROVAL_DECIDED', {
      title: `${decision} — ${request.opportunity?.name ?? request.recordType}`,
      body: dto.comment ?? dto.conditions ?? 'No comment recorded',
      entityType: 'ApprovalRequest',
      entityId: id,
    });

    return updated;
  }

  // -------------------------------------------------------------------------
  // Facts and rules
  // -------------------------------------------------------------------------

  /**
   * The numbers the rules are written about, read from what the system already
   * knows rather than typed in again.
   *
   * A fact that cannot be determined is left undefined rather than defaulted.
   * evaluateRules() then reports the rule as undetermined, which is the honest
   * answer — a margin of "unknown" is not a margin of zero and is certainly not
   * a passing margin.
   */
  private async gatherFacts(opportunityId: string): Promise<DealFacts> {
    const opportunity = await this.prisma.opportunity.findUnique({
      where: { id: opportunityId },
      select: { estimatedValue: true, currency: true, country: true },
    });

    const scenario = await this.prisma.costingScenario.findFirst({
      where: { opportunityId, isSelected: true, deletedAt: null },
      include: {
        versions: {
          where: { deletedAt: null },
          orderBy: { versionNumber: 'desc' },
          take: 1,
        },
      },
    });
    const version = scenario?.versions[0];

    const facts: DealFacts = {};

    // Computed from the live BOQ rather than read off CostingVersion.totalCost
    // and marginPercent: those are cached at APPROVAL, and pricing approval is
    // requested before the costing is approved. Reading them would leave the
    // margin unknown at exactly the moment it decides who has to sign.
    if (version) {
      const items = await this.prisma.boqItem.findMany({
        where: { package: { versionId: version.id, deletedAt: null }, deletedAt: null },
        include: { breakdown: { where: { deletedAt: null } } },
      });
      const totals = rollup(
        items.map((item) => ({
          cost: item.breakdown.reduce((s, b) => s + Number(b.totalCost), 0),
          price: Number(item.sellingTotal ?? 0),
        })),
      );
      if (totals.totalPrice > 0) {
        facts.grossMarginPercent = totals.marginPercent;
        facts.opportunityValue = totals.totalPrice;
      }
    }

    if (facts.opportunityValue === undefined && opportunity?.estimatedValue != null) {
      facts.opportunityValue = Number(opportunity.estimatedValue);
    }

    // A single-source award is a real risk the spec calls out, and the
    // quotations module already knows the answer.
    const selectedQuotes = await this.prisma.partnerQuotation.count({
      where: { opportunityId, isSelected: true, deletedAt: null },
    });
    const totalQuotes = await this.prisma.partnerQuotation.count({
      where: { opportunityId, deletedAt: null },
    });
    if (totalQuotes > 0) {
      facts.singleSourceSupplier = totalQuotes === 1 && selectedQuotes === 1;
    }

    if (scenario && opportunity) {
      facts.foreignCurrency = scenario.currency !== opportunity.currency;
    }

    // Reuses Release 3's readiness rule rather than restating it: one blocking
    // clarification makes the scope unfit to price, however complete the rest.
    const blockingClarifications = await this.prisma.clarification.count({
      where: {
        opportunityId,
        impact: 'BLOCKING',
        status: { notIn: ['ANSWERED', 'CLOSED'] },
        deletedAt: null,
      },
    });
    facts.scopeNotReady = blockingClarifications > 0;

    return facts;
  }

  /**
   * The steps a particular deal has to pass through.
   *
   * The spec keeps two separate things: a workflow's steps (the chain of desks)
   * and a rule's required approver (who this deal's risk demands). Routing
   * every request down the whole chain would make the rules decorative and
   * bury a CEO-level exception behind two desks that had no reason to see it.
   * So the chain is filtered to the roles this deal actually triggered, plus
   * any step marked mandatory, and it stays in sequence order.
   */
  private async applicableSteps(workflowId: string, requiredRoles: string[]) {
    const all = await this.prisma.workflowStep.findMany({
      where: { workflowId, deletedAt: null },
      orderBy: { sequence: 'asc' },
    });

    const needed = all.filter(
      (s) => requiredRoles.includes(s.approverRole) || s.isMandatory === true,
    );
    // Nothing matched and nothing is mandatory: fall back to the full chain
    // rather than producing a request with no approver at all.
    return needed.length > 0 ? needed : all;
  }

  private async rulesFor(opportunity: { id: string; country?: string | null; orgUnitId?: string | null }) {
    const ctx = {
      country: opportunity.country ?? null,
      orgUnitId: opportunity.orgUnitId ?? null,
      opportunityId: opportunity.id,
    };

    // The most specific active workflow: country-and-unit, then country, then
    // the group-wide one.
    const candidates = await this.prisma.workflowDefinition.findMany({
      where: {
        businessProcess: 'OPPORTUNITY_PRICING',
        isActive: true,
        deletedAt: null,
        OR: [
          { country: null, orgUnitId: null },
          { country: opportunity.country ?? undefined },
          { orgUnitId: opportunity.orgUnitId ?? undefined },
        ],
      },
      include: { rules: { where: { deletedAt: null } } },
    });

    const workflow =
      candidates.sort(
        (a, b) =>
          (b.country ? 1 : 0) + (b.orgUnitId ? 2 : 0) - ((a.country ? 1 : 0) + (a.orgUnitId ? 2 : 0)),
      )[0] ?? null;

    const rules: RuleRow[] = (workflow?.rules ?? []).map((r) => ({
      id: r.id,
      conditionField: r.conditionField as ApprovalConditionField,
      operator: r.operator as ApprovalOperator,
      threshold: r.threshold === null ? null : Number(r.threshold),
      thresholdPolicyKey: r.thresholdPolicyKey,
      requiredRole: r.requiredRole,
      priority: r.priority,
      isActive: r.isActive,
      reason: r.reason,
    }));

    return { rules, workflow, ctx };
  }
}
