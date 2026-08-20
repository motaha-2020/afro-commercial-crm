import { BadRequestException } from '@nestjs/common';
import { PendingActionService } from './pending-action.service';
import type { AuthenticatedUser } from '../../auth/auth.types';

const user: AuthenticatedUser = {
  id: 'user-1',
  email: 'pm@afro.test',
  orgUnitId: 'unit-1',
  roles: [{ role: 'PROJECT_MANAGER' as never, scope: 'OWN' as never }],
};

/**
 * Stands in for Postgres over the two statements this service uses, keeping
 * the one property that matters: the conditional DELETE returns a row to
 * exactly one caller, so a claimed code cannot be claimed again.
 */
function fakePrisma() {
  const rows: any[] = [];
  return {
    rows,
    pendingAction: {
      create: async ({ data }: any) => {
        rows.push({ ...data, createdAt: new Date() });
        return data;
      },
      deleteMany: async () => ({ count: 0 }),
    },
    $queryRaw: async (strings: TemplateStringsArray, ...values: any[]) => {
      const [userId, codeHash] = values;
      const index = rows.findIndex(
        (r) => r.userId === userId && r.codeHash === codeHash && r.expiresAt > new Date(),
      );
      if (index === -1) return [];
      const [claimed] = rows.splice(index, 1);
      return [claimed];
    },
  } as any;
}

const resolveOk = async () => ({ id: 'opp-1', name: 'شركة النيل للمقاولات' });
const resolveNothing = async () => null;

describe('PendingActionService', () => {
  it('refuses a proposal whose code resolves to nothing — before showing it', async () => {
    const service = new PendingActionService(fakePrisma());

    await expect(
      service.propose(
        user,
        { action: 'changeStage', resource: 'Opportunity', targetCode: 'OPP-9999-999999', body: {} },
        resolveNothing,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses when the named company is not the one the code belongs to', async () => {
    const service = new PendingActionService(fakePrisma());

    await expect(
      service.propose(
        user,
        {
          action: 'changeStage',
          resource: 'Opportunity',
          targetCode: 'OPP-2026-000289',
          claimedName: 'شركة أخرى تمامًا',
          body: {},
        },
        resolveOk,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts a partial name that clearly refers to the same record', async () => {
    const service = new PendingActionService(fakePrisma());

    const proposal = await service.propose(
      user,
      {
        action: 'changeStage',
        resource: 'Opportunity',
        targetCode: 'OPP-2026-000289',
        claimedName: 'شركة النيل',
        body: { stage: 'BID' },
      },
      resolveOk,
    );

    expect(proposal.code).toMatch(/^\d{4}$/);
    expect(proposal.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('executes once and only once — two simultaneous confirmations cannot both win', async () => {
    const prisma = fakePrisma();
    const service = new PendingActionService(prisma);
    const proposal = await service.propose(
      user,
      {
        action: 'changeStage',
        resource: 'Opportunity',
        targetCode: 'OPP-2026-000289',
        body: { stage: 'BID' },
      },
      resolveOk,
    );

    let executions = 0;
    const execute = async () => {
      executions += 1;
    };

    const [first, second] = await Promise.all([
      service.claim(user, proposal.code, execute),
      service.claim(user, proposal.code, execute),
    ]);

    expect(executions).toBe(1);
    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);
    expect([first.message, second.message].join(' ')).toContain('لم يُنفَّذ أي تغيير');
  });

  it('reports a failed execution as a failure, never as pending', async () => {
    const service = new PendingActionService(fakePrisma());
    const proposal = await service.propose(
      user,
      { action: 'changeStage', resource: 'Opportunity', targetCode: 'OPP-2026-000289', body: {} },
      resolveOk,
    );

    const result = await service.claim(user, proposal.code, async () => {
      throw new Error('stage exit requirements unmet');
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain('فشل التنفيذ');
  });

  it('rejects an unknown code without executing anything', async () => {
    const service = new PendingActionService(fakePrisma());
    const result = await service.claim(user, '0000', async () => {
      throw new Error('must not run');
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain('لم يُنفَّذ أي تغيير');
  });
});
