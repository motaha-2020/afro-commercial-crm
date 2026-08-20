import { Injectable } from '@nestjs/common';
import { OpportunitiesService } from '../../opportunities/opportunities.service';
import { AccountsService } from '../../accounts/accounts.service';
import { ActivitiesService } from '../../activities/activities.service';
import { project } from '../projection/projection.service';
import { accountView, activityView, opportunityView } from '../projection/view-registry';
import { codesFrom } from '../evidence/evidence-ledger';
import type { AgentTool, SpecialistAgent, ToolContext } from './agent.types';
import type { Projection } from '../projection/projection.service';

const DAY_MS = 86_400_000;

@Injectable()
export class SalesIntelligenceAgent implements SpecialistAgent {
  readonly key = 'sales_intelligence';
  readonly description = 'الفرص، الحسابات، الأنشطة، مواعيد المناقصات.';
  readonly systemPrompt =
    'أنت وكيل "ذكاء المبيعات" في منظومة أفرو التجارية. تجيب عن الفرص والحسابات ' +
    'والأنشطة ومواعيد التقديم، اعتمادًا على أدواتك وحدها.';

  constructor(
    private readonly opportunities: OpportunitiesService,
    private readonly accounts: AccountsService,
    private readonly activities: ActivitiesService,
  ) {}

  tools(): AgentTool[] {
    return [this.listOpportunities(), this.listAccounts(), this.listActivities()];
  }

  private listOpportunities(): AgentTool {
    return {
      definition: {
        name: 'list_opportunities',
        description:
          'قائمة الفرص التي يراها المستخدم الحالي، مع مجاميع محسوبة. اتركها بلا فلاتر لرؤية كل ما يراه.',
        parameters: {
          type: 'object',
          properties: {
            stage: { type: 'string', description: 'مرحلة الفرصة، مثل BID أو NEGOTIATION.' },
            status: { type: 'string', description: 'حالة الفرصة، مثل ACTIVE أو LOST.' },
            country: { type: 'string', description: 'رمز الدولة من حرفين، مثل EG.' },
            health: { type: 'string', description: 'GREEN أو AMBER أو RED.' },
            search: { type: 'string', description: 'بحث نصي في الاسم أو الكود.' },
          },
        },
      },
      run: async (args, ctx) => {
        const { items } = await this.opportunities.list(ctx.user, args as never);
        return this.deliver(ctx, 'list_opportunities', 'الفرص', items, opportunityView, {
          // Absence is three different states, and none of them is zero.
          totalOpportunities: items.length,
          withPricing: items.filter((r: any) => r.proposedPrice !== null).length,
          withoutPricing: items.filter((r: any) => r.proposedPrice === null).length,
          valueByCurrency: sumByCurrency(items),
          openCount: items.filter((r: any) => r.status === 'ACTIVE').length,
          closingWithin30Days: items.filter((r: any) => withinDays(r.expectedCloseDate, 30)).length,
          overdueCloseDate: items.filter((r: any) => isOverdue(r.expectedCloseDate, r.status)).length,
        });
      },
    };
  }

  private listAccounts(): AgentTool {
    return {
      definition: {
        name: 'list_accounts',
        description: 'قائمة الحسابات التي يراها المستخدم الحالي.',
        parameters: {
          type: 'object',
          properties: {
            search: { type: 'string', description: 'بحث في الاسم القانوني أو التجاري أو الكود.' },
            country: { type: 'string', description: 'رمز الدولة من حرفين.' },
            type: { type: 'string', description: 'نوع الحساب.' },
          },
        },
      },
      run: async (args, ctx) => {
        const { items, total } = await this.accounts.list(ctx.user, {
          ...args,
          pageSize: 200,
        } as never);
        return this.deliver(ctx, 'list_accounts', 'الحسابات', items, accountView, {
          totalAccounts: total,
          byCreditStatus: countBy(items, (r: any) => r.creditStatus),
        });
      },
    };
  }

  private listActivities(): AgentTool {
    return {
      definition: {
        name: 'list_activities',
        description: 'الأنشطة والمهام — المتابعات والمكالمات والاجتماعات.',
        parameters: {
          type: 'object',
          properties: {
            openOnly: { type: 'boolean', description: 'المفتوحة فقط (غير المكتملة).' },
            mine: { type: 'boolean', description: 'أنشطة المستخدم الحالي فقط.' },
            type: { type: 'string', description: 'نوع النشاط.' },
          },
        },
      },
      run: async (args, ctx) => {
        const result = await this.activities.list(ctx.user, {
          ...args,
          pageSize: 200,
        } as never);
        const items = (result as any).items ?? [];
        return this.deliver(ctx, 'list_activities', 'الأنشطة', items, activityView, {
          totalActivities: (result as any).total ?? items.length,
          open: items.filter((r: any) => !r.completedAt).length,
          overdue: items.filter((r: any) => isOverdue(r.dueAt, r.completedAt ? 'DONE' : 'ACTIVE'))
            .length,
        });
      },
    };
  }

  /**
   * One place where every tool result is projected and written to the ledger,
   * so no tool can hand a raw record to the model or deliver rows the sources
   * line will not know about.
   */
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

function withinDays(date: Date | null | undefined, days: number): boolean {
  if (!date) return false;
  const delta = new Date(date).getTime() - Date.now();
  return delta >= 0 && delta <= days * DAY_MS;
}

function isOverdue(date: Date | null | undefined, status: string): boolean {
  if (!date || status !== 'ACTIVE') return false;
  return new Date(date).getTime() < Date.now();
}

/** Amounts stay in their own currency — the agents never convert between them. */
function sumByCurrency(rows: any[]): Record<string, string> {
  const totals: Record<string, number> = {};
  for (const row of rows) {
    if (row.estimatedValue === null || row.estimatedValue === undefined) continue;
    totals[row.currency] = (totals[row.currency] ?? 0) + Number(row.estimatedValue);
  }
  return Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, v.toFixed(2)]));
}

function countBy<T>(rows: T[], key: (row: T) => string): Record<string, number> {
  return rows.reduce<Record<string, number>>((acc, row) => {
    const k = key(row);
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});
}
