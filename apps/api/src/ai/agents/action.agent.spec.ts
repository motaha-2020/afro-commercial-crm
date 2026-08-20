import { ActionAgent } from './action.agent';
import { ActionExecutorService } from './action-executor.service';
import { PendingActionService } from '../pending/pending-action.service';
import { EvidenceLedger } from '../evidence/evidence-ledger';
import type { ToolContext } from './agent.types';
import type { AuthenticatedUser } from '../../auth/auth.types';

const user: AuthenticatedUser = {
  id: 'user-1',
  email: 'pm@afro.test',
  orgUnitId: 'unit-1',
  roles: [{ role: 'PROJECT_MANAGER' as never, scope: 'OWN' as never }],
};

const VISIBLE = {
  id: 'opp-1',
  code: 'OPP-2026-000289',
  name: 'توريد معدات',
  account: { legalName: 'شركة النيل للمقاولات' },
};

function build(visible = [VISIBLE]) {
  const rows: any[] = [];
  const prisma = {
    pendingAction: {
      create: jest.fn(async ({ data }: any) => {
        rows.push({ ...data, createdAt: new Date() });
        return data;
      }),
    },
  };
  const opportunities = {
    list: jest.fn(async (_u: unknown, q: any) => ({
      items: visible.filter((o) => !q?.search || o.code.includes(q.search)),
    })),
    changeStage: jest.fn(async () => undefined),
    changeStatus: jest.fn(async () => undefined),
    update: jest.fn(async () => undefined),
  };

  const pending = new PendingActionService(prisma as never);
  const executor = new ActionExecutorService(opportunities as never);
  const agent = new ActionAgent(pending, executor, opportunities as never);
  const ctx: ToolContext = { user, ledger: new EvidenceLedger() };
  const tool = agent.tools()[0];

  return { agent, ctx, tool, rows, pending, executor, opportunities };
}

describe('ActionAgent — propose only', () => {
  it('issues a code and states plainly that nothing has executed', async () => {
    const { tool, ctx } = build();

    const result: any = await tool.run(
      {
        action: 'opportunity.changeStage',
        targetCode: 'OPP-2026-000289',
        body: { toStage: 'BID_STRATEGY_SOLUTION' },
      },
      ctx,
    );

    expect(result.proposed).toBe(true);
    expect(result.executed).toBe(false);
    expect(result.confirmationCode).toMatch(/^\d{4}$/);
    expect(result.instruction).toContain('لم يُنفَّذ أي تغيير بعد');
  });

  it('shows the body field by field, not as a sentence', async () => {
    const { tool, ctx } = build();

    const result: any = await tool.run(
      {
        action: 'opportunity.changeStatus',
        targetCode: 'OPP-2026-000289',
        body: { status: 'LOST', exitReason: 'PRICE' },
      },
      ctx,
    );

    // Approving a summary is not approving the request: a tender labelled
    // Sudan once passed with country "EG" under a sentence that read fine.
    expect(result.changes).toEqual([
      { field: 'الحالة الجديدة', value: 'LOST' },
      { field: 'سبب الخروج', value: 'PRICE' },
    ]);
  });

  it('refuses a code that resolves to nothing, before any code is shown', async () => {
    const { tool, ctx, rows } = build();

    const result: any = await tool.run(
      {
        action: 'opportunity.changeStage',
        targetCode: 'OPP-9999-999999',
        body: { toStage: 'BID_STRATEGY_SOLUTION' },
      },
      ctx,
    );

    expect(result.error).toContain('OPP-9999-999999');
    expect(result.confirmationCode).toBeUndefined();
    expect(rows).toHaveLength(0);
  });

  it('refuses when the named company is not the one the code belongs to', async () => {
    const { tool, ctx, rows } = build();

    // The incident this guards: a model invented a real account code that
    // belonged to a different company and proposed against it.
    const result: any = await tool.run(
      {
        action: 'opportunity.changeStage',
        targetCode: 'OPP-2026-000289',
        claimedName: 'شركة أخرى تمامًا',
        body: { toStage: 'BID_STRATEGY_SOLUTION' },
      },
      ctx,
    );

    expect(result.error).toContain('شركة النيل للمقاولات');
    expect(rows).toHaveLength(0);
  });

  it('rejects an invalid body before a person is asked to confirm it', async () => {
    const { tool, ctx, rows } = build();

    const result: any = await tool.run(
      {
        action: 'opportunity.changeStage',
        targetCode: 'OPP-2026-000289',
        body: { toStage: 'DEFINITELY_NOT_A_STAGE' },
      },
      ctx,
    );

    expect(result.error).toContain('ليست مرحلة معروفة');
    expect(rows).toHaveLength(0);
  });

  it('refuses an action outside the allow-list and names the real ones', async () => {
    const { tool, ctx } = build();

    const result: any = await tool.run(
      { action: 'opportunity.delete', targetCode: 'OPP-2026-000289', body: {} },
      ctx,
    );

    expect(result.error).toContain('opportunity.changeStage');
  });

  it('never resolves a code the asker cannot see', async () => {
    const { tool, ctx } = build([]); // nothing visible to this user

    const result: any = await tool.run(
      {
        action: 'opportunity.changeStage',
        targetCode: 'OPP-2026-000289',
        body: { toStage: 'BID_STRATEGY_SOLUTION' },
      },
      ctx,
    );

    expect(result.error).toBeDefined();
    expect(result.confirmationCode).toBeUndefined();
  });
});

describe('ActionExecutorService', () => {
  it('refuses an empty mandatory field rather than accepting a blank decision', () => {
    const { executor } = build();

    expect(() => executor.validate('opportunity.updateNextStep', { nextStep: '   ' })).toThrow(
      /فارغة/,
    );
  });

  it('runs the change through the same service the HTTP route uses', async () => {
    const { executor, opportunities } = build();

    await executor.execute(user, 'opportunity.changeStage', 'opp-1', {
      toStage: 'BID_STRATEGY_SOLUTION',
    });

    // Going through the service is what keeps the stage rules, notifications
    // and audit entry identical to a person clicking the button.
    expect(opportunities.changeStage).toHaveBeenCalledWith(user, 'opp-1', {
      toStage: 'BID_STRATEGY_SOLUTION',
    });
  });

  it('refuses an unknown action at execution time too, not just at proposal', async () => {
    const { executor } = build();

    await expect(executor.execute(user, 'opportunity.drop', 'opp-1', {})).rejects.toThrow(
      /إجراء غير معروف/,
    );
  });
});
