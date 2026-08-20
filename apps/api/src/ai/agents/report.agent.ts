import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { StorageService } from '../../documents/storage.service';
import { OpportunitiesService } from '../../opportunities/opportunities.service';
import { PricingPortfolioService } from './pricing-portfolio.service';
import { opportunityView } from '../projection/view-registry';
import { project } from '../projection/projection.service';
import { codesFrom } from '../evidence/evidence-ledger';
import type { AgentTool, SpecialistAgent, ToolContext } from './agent.types';

/** What a report may be built from. Each names a real, scoped read. */
const DATASETS = {
  opportunities: 'الفرص التي تراها، بمراحلها وقيمها ومواعيدها.',
  pricing: 'التكلفة والسعر والهامش لكل فرصة تراها.',
} as const;

type DatasetKey = keyof typeof DATASETS;

@Injectable()
export class ReportAgent implements SpecialistAgent {
  readonly key = 'report_agent';
  readonly description = 'توليد ملف تقرير، ويعيد رابط التحميل.';

  readonly systemPrompt =
    'أنت وكيل "التقارير" في منظومة أفرو التجارية. تولّد ملف تقرير من بيانات ' +
    'يراها السائل، وتعيد رابط تحميله.\n' +
    'لو رجعت الأداة حقل error فالملف لم يُنشأ: قل ذلك صراحةً ولا تعطِ رابطًا ولا ' +
    'تخترع واحدًا.\n' +
    'ولو رجع stored=false فالبيانات جاهزة لكن الملف لم يُحفظ — قل ذلك بوضوح ' +
    'ولا تقل إن التقرير جاهز للتحميل.';

  constructor(
    private readonly storage: StorageService,
    private readonly opportunities: OpportunitiesService,
    private readonly pricing: PricingPortfolioService,
  ) {}

  tools(): AgentTool[] {
    return [this.generate()];
  }

  private generate(): AgentTool {
    return {
      definition: {
        name: 'generate_report',
        description:
          'يولّد ملف CSV من بيانات يراها السائل ويعيد رابط التحميل. المجموعات المتاحة: ' +
          Object.entries(DATASETS)
            .map(([key, label]) => `${key} (${label})`)
            .join('، '),
        parameters: {
          type: 'object',
          properties: {
            dataset: {
              type: 'string',
              enum: Object.keys(DATASETS),
              description: 'مصدر بيانات التقرير.',
            },
            stage: { type: 'string', description: 'قصر التقرير على مرحلة واحدة.' },
            status: { type: 'string', description: 'قصر التقرير على حالة واحدة.' },
            country: { type: 'string', description: 'رمز الدولة من حرفين.' },
          },
          required: ['dataset'],
        },
      },
      run: async (args, ctx) => {
        const dataset = args.dataset as DatasetKey;
        if (!(dataset in DATASETS)) {
          return {
            error: `"${String(args.dataset)}" ليست مجموعة متاحة. المتاح: ${Object.keys(DATASETS).join('، ')}`,
          };
        }

        const query = {
          ...(args.stage ? { stage: args.stage } : {}),
          ...(args.status ? { status: args.status } : {}),
          ...(args.country ? { country: args.country } : {}),
        };

        const { rows, facts } = await this.collect(dataset, query, ctx);

        if (rows.length === 0) {
          // An empty file is worse than no file: it downloads, opens, and
          // reads as "we have nothing" rather than "nothing matched".
          return {
            error: 'لا توجد صفوف مطابقة ضمن ما تراه — لم يُنشأ ملف.',
            facts,
          };
        }

        const csv = toCsv(rows);
        const filename = `acms-${dataset}-${new Date().toISOString().slice(0, 10)}.csv`;
        const key = `reports/${ctx.user.id}/${randomUUID()}/${filename}`;

        // Asked before writing so "storage is down" can be told apart from
        // "the report is empty" — two failures with opposite remedies.
        const storageUp = await this.storage.ping();
        if (!storageUp) {
          return {
            stored: false,
            error: 'تخزين الملفات غير متاح الآن — التقرير لم يُحفظ ولا يوجد رابط تحميل.',
            rowCount: rows.length,
            facts,
          };
        }

        try {
          const stored = await this.storage.put(key, Buffer.from(csv, 'utf8'), 'text/csv');
          ctx.ledger.record({
            tool: 'generate_report',
            resource: `تقرير ${dataset}`,
            returned: rows.length,
            total: rows.length,
            truncated: false,
            codes: codesFrom(rows),
          });

          return {
            stored: true,
            filename,
            rowCount: rows.length,
            sizeBytes: stored.sizeBytes,
            downloadUrl: `/api/ai/reports/${encodeURIComponent(stored.storageKey)}`,
            facts,
          };
        } catch (error) {
          return {
            stored: false,
            error: `تعذّر حفظ الملف: ${error instanceof Error ? error.message : String(error)}`,
            rowCount: rows.length,
            facts,
          };
        }
      },
    };
  }

  /**
   * A report is built from the same scoped reads the chat answers come from,
   * so an exported file can never contain a row its requester could not have
   * seen on screen.
   */
  private async collect(
    dataset: DatasetKey,
    query: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<{ rows: Record<string, unknown>[]; facts: Record<string, unknown> }> {
    if (dataset === 'pricing') {
      const { rows, facts } = await this.pricing.summarise(ctx.user, query as never);
      return { rows: rows as unknown as Record<string, unknown>[], facts };
    }

    const { items } = await this.opportunities.list(ctx.user, query as never);
    // The file carries every matching row; the projection here is only about
    // which columns a reader should see, and its char budget does not apply.
    const rows = items.map((row: unknown) => opportunityView(row) as unknown as Record<string, unknown>);
    const { facts } = project([], {
      view: (r) => r,
      facts: {
        rowsInFile: rows.length,
        filters: Object.keys(query).length > 0 ? query : null,
      },
    });
    return { rows, facts };
  }
}

/**
 * RFC 4180 quoting. A legal name containing a comma is ordinary here, and a
 * file that splits it across two columns is silently wrong in a way nobody
 * notices until a total disagrees.
 */
function toCsv(rows: Record<string, unknown>[]): string {
  const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cell = (value: unknown) => {
    if (value === null || value === undefined) return '';
    const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  return [
    columns.join(','),
    ...rows.map((row) => columns.map((c) => cell(row[c])).join(',')),
    // Excel needs the trailing newline to treat the last row as complete.
  ].join('\r\n') + '\r\n';
}
