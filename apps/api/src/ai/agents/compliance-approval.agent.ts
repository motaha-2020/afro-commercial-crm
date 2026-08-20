import { Injectable } from '@nestjs/common';
import { ApprovalsService } from '../../approvals/approvals.service';
import { DiscountsService } from '../../approvals/discounts.service';
import { AuditService } from '../../audit/audit.service';
import { canReadAudit } from '../../audit/audit-reader-roles';
import { project } from '../projection/projection.service';
import { codesFrom } from '../evidence/evidence-ledger';
import type { AgentTool, SpecialistAgent, ToolContext } from './agent.types';
import type { Projection } from '../projection/projection.service';

@Injectable()
export class ComplianceApprovalAgent implements SpecialistAgent {
  readonly key = 'compliance_and_approval';
  readonly description =
    'عرض ما ينتظر موافقة، والتدقيق والحوكمة. قراءة فقط — لا يبتّ في شيء.';

  readonly systemPrompt =
    'أنت وكيل "الالتزام والموافقات" في منظومة أفرو التجارية. تعرض ما ينتظر موافقة، ' +
    'وتقرأ سجل التدقيق.\n' +
    'أنت لا تبتّ في شيء إطلاقًا. إن طلب منك السائل أن توافق أو تعتمد أو ترفض ' +
    'أو تمنح خصمًا، فقل إن ذلك يتم عبر طلب تغيير يحتاج تأكيدًا برمز، ولا تدّعِ ' +
    'أنك فعلته.\n' +
    'حقل waitingHours هو مدة الانتظار وisLate يعني تجاوز الموعد — وهما مختلفان: ' +
    'طلب ينتظر طويلًا وموعده لم يحن ليس متأخرًا.';

  constructor(
    private readonly approvals: ApprovalsService,
    private readonly discounts: DiscountsService,
    private readonly audit: AuditService,
  ) {}

  tools(): AgentTool[] {
    return [this.pendingQueue(), this.approvalDetail(), this.auditTrail()];
  }

  private pendingQueue(): AgentTool {
    return {
      definition: {
        name: 'approval_queue',
        description:
          'طلبات الموافقة في طابور السائل — ما ينتظر بتّه، أو ما سبق أن بتّ فيه.',
        parameters: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              enum: ['PENDING', 'APPROVED', 'REJECTED'],
              description: 'الحالة المطلوبة. الافتراضي PENDING.',
            },
            recordType: { type: 'string', description: 'نوع السجل، مثل Opportunity.' },
          },
        },
      },
      run: async (args, ctx) => {
        const rows = await this.approvals.myQueue(ctx.user, args as never);
        return this.deliver(ctx, 'approval_queue', 'طابور الموافقات', rows, (r: any) => ({
          opportunity: r.opportunity?.code ?? null,
          opportunityName: r.opportunity?.name ?? null,
          recordType: r.recordType,
          status: r.status,
          step: r.currentStep?.name ?? null,
          requestedBy: r.requestedBy?.fullNameAr ?? r.requestedBy?.fullNameEn ?? null,
          requestedAt: day(r.requestedAt),
          dueAt: day(r.dueAt),
          waitingHours: r.waitingHours,
          isLate: r.isLate,
        }), {
          pending: rows.length,
          // Late and long-waiting are different claims, so they are counted
          // separately rather than merged into one "overdue" number.
          late: rows.filter((r: any) => r.isLate).length,
          withoutDueDate: rows.filter((r: any) => !r.dueAt).length,
          longestWaitHours: rows.length
            ? Math.max(...rows.map((r: any) => r.waitingHours))
            : null,
        });
      },
    };
  }

  private approvalDetail(): AgentTool {
    return {
      definition: {
        name: 'approval_detail',
        description: 'تفاصيل طلب موافقة واحد بمعرّفه كما ظهر في الطابور.',
        parameters: {
          type: 'object',
          properties: {
            requestId: { type: 'string', description: 'معرّف طلب الموافقة.' },
          },
          required: ['requestId'],
        },
      },
      run: async (args, ctx) => {
        const id = String(args.requestId ?? '');
        if (!id) return { error: 'لم يُذكر معرّف طلب الموافقة.' };

        const request: any = await this.approvals.findOne(ctx.user, id);
        ctx.ledger.record({
          tool: 'approval_detail',
          resource: `طلب موافقة ${request?.opportunity?.code ?? ''}`.trim(),
          returned: 1,
          total: 1,
          truncated: false,
          codes: request?.opportunity?.code ? [request.opportunity.code] : [],
        });

        return {
          opportunity: request?.opportunity?.code ?? null,
          recordType: request?.recordType,
          status: request?.status,
          requestedAt: day(request?.requestedAt),
          dueAt: day(request?.dueAt),
          step: request?.currentStep?.name ?? null,
          firedRules: request?.firedRules ?? null,
          actions: (request?.actions ?? []).map((a: any) => ({
            decision: a.decision,
            by: a.actor?.fullNameAr ?? a.actor?.fullNameEn ?? null,
            at: day(a.createdAt),
            comment: a.comment ?? null,
          })),
        };
      },
    };
  }

  private auditTrail(): AgentTool {
    return {
      definition: {
        name: 'audit_trail',
        description:
          'سجل التدقيق لسجل واحد: من غيّر ماذا ومتى. يحتاج نوع السجل ومعرّفه.',
        parameters: {
          type: 'object',
          properties: {
            entityType: { type: 'string', description: 'نوع السجل، مثل Opportunity.' },
            entityId: { type: 'string', description: 'معرّف السجل.' },
          },
          required: ['entityType', 'entityId'],
        },
      },
      run: async (args, ctx) => {
        // The HTTP route is role-gated, and this path does not pass through
        // that guard — the agent calls the service in-process. Without this
        // check the assistant would hand any user a trail the API refuses
        // them, which is the exact leak the guard exists to prevent.
        if (!canReadAudit(ctx.user.roles)) {
          return { error: 'سجل التدقيق غير متاح لدورك — لم يُقرأ منه شيء.' };
        }

        const entityType = String(args.entityType ?? '');
        const entityId = String(args.entityId ?? '');
        if (!entityType || !entityId) {
          return { error: 'سجل التدقيق يحتاج نوع السجل ومعرّفه معًا.' };
        }

        const rows: any[] = await this.audit.forEntity(entityType, entityId);
        return this.deliver(ctx, 'audit_trail', `تدقيق ${entityType}`, rows, (r: any) => ({
          action: r.action,
          by: r.user?.fullNameAr ?? r.user?.fullNameEn ?? null,
          at: day(r.createdAt),
          changedFields: r.before && r.after ? changedKeys(r.before, r.after) : null,
        }), {
          entries: rows.length,
          firstAt: rows.length ? day(rows[rows.length - 1]?.createdAt) : null,
          lastAt: rows.length ? day(rows[0]?.createdAt) : null,
        });
      },
    };
  }

  private deliver<T>(
    ctx: ToolContext,
    tool: string,
    resource: string,
    rows: T[],
    view: (row: T) => unknown,
    facts: Record<string, unknown>,
  ): Projection<unknown> {
    const projection = project(rows, { view, facts });
    ctx.ledger.record({
      tool,
      resource,
      returned: projection.returned,
      total: projection.total,
      truncated: projection.truncated,
      codes: codesFrom(projection.items),
    });
    return projection;
  }
}

const day = (value: Date | string | null | undefined): string | null =>
  value ? new Date(value).toISOString().slice(0, 10) : null;

/**
 * Names which fields moved rather than dumping both snapshots: the audit rows
 * carry whole records, and sending two of them per entry would spend the
 * entire budget on one history.
 */
function changedKeys(before: unknown, after: unknown): string[] {
  const b = (before ?? {}) as Record<string, unknown>;
  const a = (after ?? {}) as Record<string, unknown>;
  return [...new Set([...Object.keys(b), ...Object.keys(a)])].filter(
    (k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]),
  );
}
