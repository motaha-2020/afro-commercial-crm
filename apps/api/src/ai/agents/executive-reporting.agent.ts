import { Injectable } from '@nestjs/common';
import { METRIC_CODES, type MetricCode } from '@acms/shared';
import { MetricsService } from '../../metrics/metrics.service';
import { AnalyticsService } from '../../metrics/analytics.service';
import { project } from '../projection/projection.service';
import type { AgentTool, SpecialistAgent, ToolContext } from './agent.types';
import type { Projection } from '../projection/projection.service';

@Injectable()
export class ExecutiveReportingAgent implements SpecialistAgent {
  readonly key = 'executive_reporting';
  readonly description = 'المؤشرات وملخصات الإدارة وشرح المؤشرات.';
  readonly systemPrompt =
    'أنت وكيل "التقارير التنفيذية" في منظومة أفرو التجارية. تجيب عن المؤشرات ' +
    'وملخّصات الإدارة، وتشرح ما الذي يقيسه كل مؤشر.\n' +
    'قيمة null في أي مؤشر معناها لا توجد بيانات لحسابه — وهذا ليس صفرًا ولا يُقال ' +
    'كأنه صفر؛ اذكر السبب المرفق في unavailableReason.\n' +
    'وحقل basis يقول على كم سجل يقوم الرقم: مؤشر بنسبة ١٠٠٪ قائم على صفقة واحدة ' +
    'يجب أن يُذكر معه أنه قائم على صفقة واحدة.\n' +
    'وحقل withheldFromThisRole يعدّد المؤشرات التي لا يحقّ للسائل رؤيتها — قل إنها ' +
    'حُجبت، ولا تقل إن قيمتها صفر ولا تحاول تقديرها.';

  constructor(
    private readonly metrics: MetricsService,
    private readonly analytics: AnalyticsService,
  ) {}

  tools(): AgentTool[] {
    return [this.dashboard(), this.report(), this.explainMetric(), this.overview()];
  }

  private dashboard(): AgentTool {
    return {
      definition: {
        name: 'executive_dashboard',
        description:
          'لوحة مؤشرات السائل — المؤشرات التي يحقّ لدوره رؤيتها، محسوبة على ما يراه من بيانات.',
        parameters: { type: 'object', properties: {} },
      },
      run: async (_args, ctx) => {
        const result = await this.metrics.dashboard(ctx.user);
        return this.deliverMetrics(ctx, 'executive_dashboard', 'لوحة المؤشرات', result, {
          // Named rather than dropped: a reader told the screen is partial
          // will ask about the rest; one left to assume will not.
          pendingErpIntegration: result.pendingErpIntegration,
        });
      },
    };
  }

  private report(): AgentTool {
    return {
      definition: {
        name: 'metrics_report',
        description: 'مؤشرات محددة بالاسم. استخدمها حين يسأل السائل عن مؤشر أو مؤشرات بعينها.',
        parameters: {
          type: 'object',
          properties: {
            codes: {
              type: 'array',
              items: { type: 'string', enum: [...METRIC_CODES] },
              description: 'أكواد المؤشرات المطلوبة.',
            },
          },
          required: ['codes'],
        },
      },
      run: async (args, ctx) => {
        const requested = Array.isArray(args.codes) ? (args.codes as string[]) : [];
        const known = requested.filter((c): c is MetricCode =>
          (METRIC_CODES as readonly string[]).includes(c),
        );
        const unknown = requested.filter((c) => !(METRIC_CODES as readonly string[]).includes(c));

        if (known.length === 0) {
          // Listing the real codes back is what gets a model onto a real path;
          // a bare rejection leaves it free to invent another name.
          return {
            error:
              `لا مؤشر بهذه الأسماء: ${requested.join('، ') || '(فارغ)'}. ` +
              `المتاح: ${METRIC_CODES.join('، ')}`,
          };
        }

        const result = await this.metrics.report(ctx.user, known);
        return this.deliverMetrics(ctx, 'metrics_report', 'المؤشرات', result, {
          // Three different reasons a requested metric is missing, kept apart:
          // not permitted, not a real metric, and permitted but uncomputable.
          withheldFromThisRole: result.withheld,
          unknownCodes: unknown,
        });
      },
    };
  }

  private explainMetric(): AgentTool {
    return {
      definition: {
        name: 'explain_metric',
        description:
          'تعريف مؤشر واحد: صيغته، والقرار الذي يخدمه، ومالك تعريفه، وهل هو قابل للتلاعب.',
        parameters: {
          type: 'object',
          properties: {
            code: { type: 'string', enum: [...METRIC_CODES], description: 'كود المؤشر.' },
          },
          required: ['code'],
        },
      },
      run: async (args, ctx) => {
        const code = args.code as MetricCode;
        if (!(METRIC_CODES as readonly string[]).includes(code)) {
          return {
            error: `لا مؤشر بالكود ${String(args.code)}. المتاح: ${METRIC_CODES.join('، ')}`,
          };
        }

        const value = await this.metrics.metric(ctx.user, code);
        // A definition carries no record codes, so the ledger notes that a
        // tool ran and delivered one row — and claims nothing further.
        ctx.ledger.record({
          tool: 'explain_metric',
          resource: `تعريف ${code}`,
          returned: 1,
          total: 1,
          truncated: false,
          codes: [],
        });

        return {
          code,
          definition: value.definition,
          currentValue: value.value,
          unit: value.unit,
          basis: value.basis,
          unavailableReason: value.unavailableReason ?? null,
        };
      },
    };
  }

  private overview(): AgentTool {
    return {
      definition: {
        name: 'analytics_overview',
        description: 'توزيع خط الأنابيب — حسب المرحلة والدولة والقطاع، لملخّصات الإدارة.',
        parameters: {
          type: 'object',
          properties: {
            from: { type: 'string', description: 'تاريخ البداية YYYY-MM-DD.' },
            to: { type: 'string', description: 'تاريخ النهاية YYYY-MM-DD.' },
          },
        },
      },
      run: async (args, ctx) => {
        const result = await this.analytics.overview(ctx.user, args as never);
        ctx.ledger.record({
          tool: 'analytics_overview',
          resource: 'توزيع خط الأنابيب',
          returned: 1,
          total: 1,
          truncated: false,
          codes: [],
        });
        return result;
      },
    };
  }

  /**
   * Metrics arrive already computed, already carrying their definitions, and
   * already distinguishing "no data" from zero. Projection here is only about
   * size — recomputing any of it is exactly what the prompt forbids.
   */
  private deliverMetrics(
    ctx: ToolContext,
    tool: string,
    resource: string,
    result: { metrics: any[]; scope: Record<string, unknown>; asOf: Date },
    extraFacts: Record<string, unknown>,
  ): Projection<unknown> {
    const projection = project(result.metrics, {
      view: (m: any) => ({
        code: m.code,
        value: m.value,
        unit: m.unit,
        basis: m.basis,
        unavailableReason: m.unavailableReason ?? null,
        formula: m.definition?.formula ?? null,
        gameable: m.definition?.gameable ?? null,
      }),
      facts: {
        asOf: result.asOf,
        scope: result.scope,
        computed: result.metrics.filter((m) => m.value !== null).length,
        // A metric that could not be computed is its own outcome, and its
        // reason travels with it rather than being flattened into one count.
        noData: result.metrics.filter((m) => m.unavailableReason === 'NO_DATA').length,
        notSupported: result.metrics.filter((m) => m.unavailableReason === 'NOT_SUPPORTED').length,
        ...extraFacts,
      },
    });

    ctx.ledger.record({
      tool,
      resource,
      returned: projection.returned,
      total: projection.total,
      truncated: projection.truncated,
      // Metrics are aggregates over records, not records — citing a record
      // code from here would be citing something never delivered.
      codes: [],
    });

    return projection;
  }
}
