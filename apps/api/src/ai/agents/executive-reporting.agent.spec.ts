import { ExecutiveReportingAgent } from './executive-reporting.agent';
import { EvidenceLedger } from '../evidence/evidence-ledger';
import type { ToolContext } from './agent.types';
import type { AuthenticatedUser } from '../../auth/auth.types';

const user: AuthenticatedUser = {
  id: 'user-1',
  email: 'ceo@afro.test',
  orgUnitId: 'unit-1',
  roles: [{ role: 'CEO' as never, scope: 'GROUP' as never }],
};

const metric = (code: string, value: number | null, extra: Record<string, unknown> = {}) => ({
  code,
  value,
  unit: 'COUNT',
  basis: value === null ? 0 : 3,
  definition: { formula: `formula for ${code}`, gameable: false },
  ...extra,
});

function build(overrides: { metrics?: any[]; withheld?: string[] } = {}) {
  const metrics = {
    dashboard: jest.fn(async () => ({
      asOf: new Date('2026-08-20T00:00:00Z'),
      metrics: overrides.metrics ?? [metric('PIPELINE_VALUE', 1200)],
      pendingErpIntegration: ['CASH_COLLECTED'],
      scope: { opportunities: 3, approvedCostings: 1 },
    })),
    report: jest.fn(async () => ({
      asOf: new Date('2026-08-20T00:00:00Z'),
      metrics: overrides.metrics ?? [metric('WIN_RATE', null, { unavailableReason: 'NO_DATA' })],
      withheld: overrides.withheld ?? [],
      scope: { opportunities: 3, approvedCostings: 1 },
    })),
    metric: jest.fn(async () => metric('WIN_RATE', null, { unavailableReason: 'NO_DATA' })),
  };
  const analytics = { overview: jest.fn(async () => ({ byStage: [] })) };

  const agent = new ExecutiveReportingAgent(metrics as never, analytics as never);
  const ctx: ToolContext = { user, ledger: new EvidenceLedger(), artifacts: [] };
  const tool = (name: string) => agent.tools().find((t) => t.definition.name === name)!;

  return { agent, ctx, tool, metrics };
}

describe('ExecutiveReportingAgent', () => {
  it('passes an uncomputable metric through as null with its reason, never as zero', async () => {
    const { tool, ctx } = build({
      metrics: [metric('WIN_RATE', null, { unavailableReason: 'NO_DATA' })],
    });

    const result: any = await tool('metrics_report').run({ codes: ['WIN_RATE'] }, ctx);

    expect(result.items[0].value).toBeNull();
    expect(result.items[0].unavailableReason).toBe('NO_DATA');
    expect(result.facts.computed).toBe(0);
    expect(result.facts.noData).toBe(1);
  });

  it('keeps withheld, unknown and uncomputable as three separate outcomes', async () => {
    const { tool, ctx } = build({
      metrics: [metric('PIPELINE_VALUE', 900), metric('WIN_RATE', null, { unavailableReason: 'NO_DATA' })],
      withheld: ['GROSS_MARGIN'],
    });

    const result: any = await tool('metrics_report').run(
      // GROSS_MARGIN is refused by role, NOT_A_METRIC does not exist, and
      // WIN_RATE is permitted but has nothing to compute from.
      { codes: ['PIPELINE_VALUE', 'GROSS_MARGIN', 'WIN_RATE', 'NOT_A_METRIC'] },
      ctx,
    );

    expect(result.facts.withheldFromThisRole).toEqual(['GROSS_MARGIN']);
    expect(result.facts.unknownCodes).toEqual(['NOT_A_METRIC']);
    expect(result.facts.noData).toBe(1);
    expect(result.facts.computed).toBe(1);
  });

  it('refuses an all-invented code list and names the real codes back', async () => {
    const { tool, ctx, metrics } = build();

    const result: any = await tool('metrics_report').run({ codes: ['REVENUE_PER_HUG'] }, ctx);

    expect(result.error).toContain('REVENUE_PER_HUG');
    expect(result.error).toContain('PIPELINE_VALUE');
    expect(metrics.report).not.toHaveBeenCalled();
  });

  it('carries the basis so a rate resting on one deal is visible as such', async () => {
    const { tool, ctx } = build({
      metrics: [metric('WIN_RATE', 100, { basis: 1 })],
    });

    const result: any = await tool('metrics_report').run({ codes: ['WIN_RATE'] }, ctx);

    expect(result.items[0]).toMatchObject({ value: 100, basis: 1 });
  });

  it('names what the dashboard is still missing rather than omitting it', async () => {
    const { tool, ctx } = build();

    const result: any = await tool('executive_dashboard').run({}, ctx);

    expect(result.facts.pendingErpIntegration).toEqual(['CASH_COLLECTED']);
  });

  it('cites no record codes — a metric is an aggregate, not a record', async () => {
    const { tool, ctx } = build();

    await tool('executive_dashboard').run({}, ctx);

    expect(ctx.ledger.codes().size).toBe(0);
    expect(ctx.ledger.sourceLine()).toContain('لوحة المؤشرات');
  });
});
