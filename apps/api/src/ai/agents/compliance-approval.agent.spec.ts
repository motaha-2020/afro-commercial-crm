import { ComplianceApprovalAgent } from './compliance-approval.agent';
import { EvidenceLedger } from '../evidence/evidence-ledger';
import type { ToolContext } from './agent.types';
import type { AuthenticatedUser } from '../../auth/auth.types';

const asRole = (role: string): AuthenticatedUser => ({
  id: 'user-1',
  email: 'someone@afro.test',
  orgUnitId: 'unit-1',
  roles: [{ role: role as never, scope: 'OWN' as never }],
});

function build(queue: any[] = []) {
  const approvals = {
    myQueue: jest.fn(async () => queue),
    findOne: jest.fn(async () => ({ opportunity: { code: 'OPP-2026-000289' }, actions: [] })),
  };
  const discounts = {};
  const audit = {
    forEntity: jest.fn(async () => [
      {
        action: 'STATUS_CHANGE',
        createdAt: new Date('2026-08-01'),
        user: { fullNameAr: 'محمد' },
        before: { stage: 'COSTING_SOURCING', name: 'x' },
        after: { stage: 'MANAGEMENT_APPROVAL', name: 'x' },
      },
    ]),
  };

  const agent = new ComplianceApprovalAgent(approvals as never, discounts as never, audit as never);
  const tool = (name: string) => agent.tools().find((t) => t.definition.name === name)!;
  const ctxFor = (role: string): ToolContext => ({
    user: asRole(role),
    ledger: new EvidenceLedger(),
    artifacts: [],
  });

  return { agent, tool, ctxFor, audit, approvals };
}

describe('ComplianceApprovalAgent', () => {
  // The HTTP route for the audit trail is role-gated, and the agent calls the
  // service in-process — so the gate has to exist here too or the assistant
  // becomes a way around it.
  it('refuses the audit trail to a role the HTTP route would refuse', async () => {
    const { tool, ctxFor, audit } = build();

    const result: any = await tool('audit_trail').run(
      { entityType: 'Opportunity', entityId: 'opp-1' },
      ctxFor('PROJECT_MANAGER'),
    );

    expect(result.error).toContain('غير متاح لدورك');
    expect(audit.forEntity).not.toHaveBeenCalled();
  });

  it('allows the audit trail to a governance role', async () => {
    const { tool, ctxFor, audit } = build();

    const result: any = await tool('audit_trail').run(
      { entityType: 'Opportunity', entityId: 'opp-1' },
      ctxFor('FINANCE'),
    );

    expect(result.error).toBeUndefined();
    expect(audit.forEntity).toHaveBeenCalled();
  });

  it('names which fields moved instead of dumping both snapshots', async () => {
    const { tool, ctxFor } = build();

    const result: any = await tool('audit_trail').run(
      { entityType: 'Opportunity', entityId: 'opp-1' },
      ctxFor('CEO'),
    );

    expect(result.items[0].changedFields).toEqual(['stage']);
  });

  it('keeps waiting and late as separate counts', async () => {
    const { tool, ctxFor } = build([
      { status: 'PENDING', waitingHours: 200, isLate: false, dueAt: new Date('2027-01-01'), opportunity: {} },
      { status: 'PENDING', waitingHours: 5, isLate: true, dueAt: new Date('2026-08-01'), opportunity: {} },
      { status: 'PENDING', waitingHours: 30, isLate: false, dueAt: null, opportunity: {} },
    ]);

    const result: any = await tool('approval_queue').run({}, ctxFor('FINANCE'));

    // A request waiting a long time whose due date has not arrived is not late.
    expect(result.facts).toMatchObject({
      pending: 3,
      late: 1,
      withoutDueDate: 1,
      longestWaitHours: 200,
    });
  });

  it('reports no longest wait rather than zero when the queue is empty', async () => {
    const { tool, ctxFor } = build([]);

    const result: any = await tool('approval_queue').run({}, ctxFor('FINANCE'));

    // Zero hours would read as "nothing is waiting long", which is a claim
    // about a queue that does not exist.
    expect(result.facts.longestWaitHours).toBeNull();
    expect(result.facts.pending).toBe(0);
  });
});
