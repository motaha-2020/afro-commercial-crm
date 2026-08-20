import { Injectable } from '@nestjs/common';
import { CostingService } from '../../costing/costing.service';
import { QuotationsService } from '../../quotations/quotations.service';
import { OpportunitiesService } from '../../opportunities/opportunities.service';
import { PricingPortfolioService } from './pricing-portfolio.service';
import { project } from '../projection/projection.service';
import { codesFrom } from '../evidence/evidence-ledger';
import type { AgentTool, SpecialistAgent, ToolContext } from './agent.types';
import type { Projection } from '../projection/projection.service';
import type { AuthenticatedUser } from '../../auth/auth.types';

@Injectable()
export class FinancialIntelligenceAgent implements SpecialistAgent {
  readonly key = 'financial_intelligence';
  readonly description = 'التكلفة، التسعير، الهوامش، عروض الموردين.';
  readonly systemPrompt =
    'أنت وكيل "الذكاء المالي" في منظومة أفرو التجارية. تجيب عن التكلفة والتسعير ' +
    'والهوامش وعروض الموردين.\n' +
    'انتبه: الهامش محسوب على سعر البيع لا على التكلفة. وحقول facts تفرّق بين ' +
    '"priced" و"unpriced" و"unreadable" و"notRead" — وهي أربع حالات مختلفة، ' +
    'ولا يجوز أن تُقرأ أي منها على أنها صفر.';

  constructor(
    private readonly portfolio: PricingPortfolioService,
    private readonly costing: CostingService,
    private readonly quotations: QuotationsService,
    private readonly opportunities: OpportunitiesService,
  ) {}

  tools(): AgentTool[] {
    return [this.pricingOverview(), this.opportunityCosting(), this.supplierQuotations()];
  }

  /** The cross-opportunity question that otherwise has no path at all. */
  private pricingOverview(): AgentTool {
    return {
      definition: {
        name: 'pricing_overview',
        description:
          'ملخّص التكلفة والسعر والهامش عبر كل الفرص التي يراها المستخدم. استخدمها لأي سؤال ' +
          'عن التكاليف أو الهوامش بشكل عام، لا عن فرصة بعينها.',
        parameters: {
          type: 'object',
          properties: {
            stage: { type: 'string', description: 'قصر النتائج على مرحلة واحدة.' },
            status: { type: 'string', description: 'قصر النتائج على حالة واحدة.' },
            country: { type: 'string', description: 'رمز الدولة من حرفين.' },
          },
        },
      },
      run: async (args, ctx) => {
        const { rows, facts } = await this.portfolio.summarise(ctx.user, args as never);
        return this.deliver(ctx, 'pricing_overview', 'تسعير الفرص', rows, (r) => r, facts);
      },
    };
  }

  private opportunityCosting(): AgentTool {
    return {
      definition: {
        name: 'opportunity_costing',
        description: 'سيناريوهات التكلفة ونسخها لفرصة واحدة محددة بكودها.',
        parameters: {
          type: 'object',
          properties: {
            opportunityCode: {
              type: 'string',
              description: 'كود الفرصة، مثل OPP-2026-000289.',
            },
          },
          required: ['opportunityCode'],
        },
      },
      run: async (args, ctx) => {
        const opp = await this.resolve(ctx.user, args.opportunityCode);
        if (!opp) return { error: `لا توجد فرصة بالكود ${String(args.opportunityCode)} ضمن ما تراه.` };

        const scenarios = await this.costing.listScenarios(ctx.user, opp.id);
        return this.deliver(
          ctx,
          'opportunity_costing',
          `تكلفة ${opp.code}`,
          scenarios,
          (s: any) => ({
            opportunity: opp.code,
            scenario: s.name,
            type: s.type,
            currency: s.currency,
            isSelected: s.isSelected,
            versions: s.versions.map((v: any) => ({
              versionNumber: v.versionNumber,
              status: v.status,
              totalCost: v.totalCost === null ? null : String(v.totalCost),
              totalPrice: v.totalPrice === null ? null : String(v.totalPrice),
              marginPercent: v.marginPercent === null ? null : String(v.marginPercent),
              locked: v.lockedAt !== null,
            })),
          }),
          {
            scenarioCount: scenarios.length,
            selectedScenario: scenarios.find((s: any) => s.isSelected)?.name ?? null,
            // Null, not zero: "no scenario has been built" is not "the cost is nothing".
            hasAnyVersion: scenarios.some((s: any) => s.versions.length > 0),
          },
        );
      },
    };
  }

  private supplierQuotations(): AgentTool {
    return {
      definition: {
        name: 'supplier_quotations',
        description: 'عروض الموردين المستلمة لفرصة واحدة محددة بكودها.',
        parameters: {
          type: 'object',
          properties: {
            opportunityCode: { type: 'string', description: 'كود الفرصة.' },
          },
          required: ['opportunityCode'],
        },
      },
      run: async (args, ctx) => {
        const opp = await this.resolve(ctx.user, args.opportunityCode);
        if (!opp) return { error: `لا توجد فرصة بالكود ${String(args.opportunityCode)} ضمن ما تراه.` };

        const rows = await this.quotations.listQuotations(ctx.user, opp.id);
        return this.deliver(
          ctx,
          'supplier_quotations',
          `عروض موردي ${opp.code}`,
          rows,
          (q: any) => ({
            opportunity: opp.code,
            partner: q.partner?.legalName ?? null,
            partnerCode: q.partner?.code ?? null,
            currency: q.currency,
            totalAmount: q.totalAmount === null ? null : String(q.totalAmount),
            validUntil: q.validUntil ? new Date(q.validUntil).toISOString().slice(0, 10) : null,
            isExpired: q.isExpired,
            blacklistedPartner: q.partner?.isBlacklisted ?? null,
          }),
          {
            quotationCount: rows.length,
            expired: rows.filter((q: any) => q.isExpired).length,
            fromBlacklistedPartners: rows.filter((q: any) => q.partner?.isBlacklisted).length,
            withoutAmount: rows.filter((q: any) => q.totalAmount === null).length,
          },
        );
      },
    };
  }

  /**
   * The model speaks in codes because the guard forbids it seeing ids. This is
   * the only place a code becomes an id, and it does so through the scoped
   * list — so a code outside the user's visibility resolves to nothing.
   */
  private async resolve(user: AuthenticatedUser, code: unknown) {
    if (typeof code !== 'string' || code.trim() === '') return null;
    const { items } = await this.opportunities.list(user, { search: code.trim() } as never);
    return items.find((o: any) => o.code === code.trim()) ?? null;
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
