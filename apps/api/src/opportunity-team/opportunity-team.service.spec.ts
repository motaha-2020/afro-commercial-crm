import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OpportunityTeamService } from './opportunity-team.service';
import type { AuthenticatedUser } from '../auth/auth.types';

const actor: AuthenticatedUser = {
  id: 'user-1',
  email: 'sd@afro.example',
  orgUnitId: 'org-1',
  roles: [{ role: 'SALES_DIRECTOR', scope: 'GROUP' }],
};

function build({
  member = {
    id: 'user-2',
    isActive: true,
    fullNameEn: 'Nadia Haddad',
    roles: [{ role: 'ESTIMATION' }, { role: 'PROCUREMENT' }],
  } as unknown,
  rows = [] as unknown[],
  existing = { id: 'tm-1', opportunityId: 'opp-1', userId: 'user-2', role: 'ESTIMATION', isLead: false } as unknown,
} = {}) {
  const tx = {
    opportunityTeam: {
      updateMany: jest.fn(),
      upsert: jest.fn().mockImplementation(({ create }) => ({ id: 'tm-1', ...create })),
      update: jest.fn().mockImplementation(({ data }) => ({ id: 'tm-1', ...data })),
    },
  };

  const prisma = {
    user: { findFirst: jest.fn().mockResolvedValue(member) },
    opportunityTeam: {
      findMany: jest.fn().mockResolvedValue(rows),
      findFirst: jest.fn().mockResolvedValue(existing),
      update: jest.fn().mockImplementation(({ data }) => ({ id: 'tm-1', ...data })),
    },
    $transaction: jest.fn().mockImplementation((fn: (t: unknown) => unknown) => fn(tx)),
  };

  const service = new OpportunityTeamService(
    prisma as never,
    { record: jest.fn(), recordUpdate: jest.fn() } as never,
    { assert: jest.fn().mockResolvedValue({ id: 'opp-1' }) } as never,
  );

  return { service, prisma, tx };
}

describe('adding a team member', () => {
  it('refuses somebody who does not hold the role they are being added under', async () => {
    // A FINANCE line on the bid team that finance never granted reads as a
    // control and is not one.
    const { service } = build();

    await expect(
      service.add(actor, 'opp-1', { userId: 'user-2', role: 'FINANCE' } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts a role the user actually holds', async () => {
    const { service, tx } = build();

    await service.add(actor, 'opp-1', { userId: 'user-2', role: 'ESTIMATION' } as never);

    expect(tx.opportunityTeam.upsert).toHaveBeenCalled();
  });

  it('lets one person hold two roles, because roles are rows', async () => {
    const { service, tx } = build();

    await service.add(actor, 'opp-1', { userId: 'user-2', role: 'ESTIMATION' } as never);
    await service.add(actor, 'opp-1', { userId: 'user-2', role: 'PROCUREMENT' } as never);

    const roles = tx.opportunityTeam.upsert.mock.calls.map((c) => c[0].create.role);
    expect(roles).toEqual(['ESTIMATION', 'PROCUREMENT']);
  });

  it('refuses a deactivated user, who staffs the team on paper only', async () => {
    const { service } = build({
      member: { id: 'user-2', isActive: false, roles: [{ role: 'ESTIMATION' }] },
    });

    await expect(
      service.add(actor, 'opp-1', { userId: 'user-2', role: 'ESTIMATION' } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reports an unknown user as absent', async () => {
    const { service } = build({ member: null });

    await expect(
      service.add(actor, 'opp-1', { userId: 'ghost', role: 'ESTIMATION' } as never),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('revives a removed membership rather than colliding on the unique triple', async () => {
    const { service, tx } = build();

    await service.add(actor, 'opp-1', { userId: 'user-2', role: 'ESTIMATION' } as never);

    expect(tx.opportunityTeam.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ deletedAt: null }) }),
    );
  });
});

describe('the bid lead', () => {
  it('steps the incumbent down in the same transaction', async () => {
    const { service, tx } = build();

    await service.add(actor, 'opp-1', {
      userId: 'user-2',
      role: 'ESTIMATION',
      isLead: true,
    } as never);

    expect(tx.opportunityTeam.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ opportunityId: 'opp-1', isLead: true }),
        data: { isLead: false },
      }),
    );
  });

  it('leaves the incumbent alone for an ordinary member', async () => {
    const { service, tx } = build();

    await service.add(actor, 'opp-1', { userId: 'user-2', role: 'ESTIMATION' } as never);

    expect(tx.opportunityTeam.updateMany).not.toHaveBeenCalled();
  });

  it('does not demote anyone when promoting the member who is already lead', async () => {
    const { service, tx } = build({
      existing: { id: 'tm-1', opportunityId: 'opp-1', userId: 'user-2', role: 'ESTIMATION', isLead: true },
    });

    await service.update(actor, 'tm-1', { isLead: true });

    expect(tx.opportunityTeam.updateMany).not.toHaveBeenCalled();
  });

  it('says out loud when a team has no lead at all', async () => {
    const { service } = build({
      rows: [{ id: 'tm-1', isLead: false, user: { id: 'user-2' } }],
    });

    const result = await service.list(actor, 'opp-1');

    expect(result.hasLead).toBe(false);
  });
});

describe('removing a member', () => {
  it('soft-deletes, keeping who was on the bid answerable afterwards', async () => {
    const { service, prisma } = build();

    await service.remove(actor, 'tm-1');

    expect(prisma.opportunityTeam.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { deletedAt: expect.any(Date) } }),
    );
  });
});
