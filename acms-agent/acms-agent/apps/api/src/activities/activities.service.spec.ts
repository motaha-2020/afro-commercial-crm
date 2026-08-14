import { BadRequestException } from '@nestjs/common';
import { ActivitiesService } from './activities.service';
import type { AuthenticatedUser } from '../auth/auth.types';

const user: AuthenticatedUser = {
  id: 'user-1',
  email: 'am@afro.example',
  orgUnitId: 'org-1',
  roles: [{ role: 'ACCOUNT_MANAGER', scope: 'GROUP' }],
};

function build(overrides: { activity?: Record<string, unknown> } = {}) {
  const prisma = {
    activity: {
      create: jest.fn().mockImplementation(({ data }) => ({ id: 'act-1', ...data })),
      findFirst: jest.fn().mockResolvedValue(
        overrides.activity ?? {
          id: 'act-1',
          type: 'TASK',
          subject: 'Send the pricing summary',
          accountId: 'acc-1',
          opportunityId: null,
          leadId: null,
          completedAt: null,
        },
      ),
      update: jest.fn().mockImplementation(({ data }) => ({ id: 'act-1', ...data })),
    },
    opportunity: { findUnique: jest.fn().mockResolvedValue({ accountId: 'acc-1' }) },
    lead: { findFirst: jest.fn().mockResolvedValue({ id: 'lead-1', accountId: 'acc-2' }) },
  };

  const service = new ActivitiesService(
    prisma as never,
    { record: jest.fn(), recordUpdate: jest.fn() } as never,
    { buildFilter: jest.fn().mockResolvedValue({}) } as never,
    {
      assert: jest.fn().mockResolvedValue({ id: 'acc-1' }),
      assertContact: jest.fn().mockResolvedValue({ id: 'con-1', accountId: 'acc-1' }),
    } as never,
    { assert: jest.fn().mockResolvedValue({ id: 'opp-1' }) } as never,
  );

  return { service, prisma };
}

describe('creating an activity', () => {
  it('refuses one with nothing to hang off', async () => {
    const { service } = build();

    await expect(
      service.create(user, { type: 'NOTE', subject: 'orphan' } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('completes a logged call on the spot', async () => {
    const { service, prisma } = build();

    await service.create(user, {
      type: 'CALL',
      subject: 'Intro call',
      accountId: 'acc-1',
    } as never);

    expect(prisma.activity.create.mock.calls[0][0].data.completedAt).toBeInstanceOf(Date);
  });

  it('leaves a task open, because a task has not happened yet', async () => {
    const { service, prisma } = build();

    await service.create(user, {
      type: 'TASK',
      subject: 'Send the summary',
      accountId: 'acc-1',
    } as never);

    expect(prisma.activity.create.mock.calls[0][0].data.completedAt).toBeUndefined();
  });

  it('fills in the account behind an opportunity, keeping its timeline whole', async () => {
    const { service, prisma } = build();

    await service.create(user, {
      type: 'MEETING',
      subject: 'Kick-off',
      opportunityId: 'opp-1',
    } as never);

    expect(prisma.activity.create.mock.calls[0][0].data.accountId).toBe('acc-1');
  });

  it('rejects a contact paired with the wrong company', async () => {
    const { service } = build();

    await expect(
      service.create(user, {
        type: 'CALL',
        subject: 'Wrong company',
        contactId: 'con-1',
        accountId: 'acc-other',
      } as never),
    ).rejects.toThrow(/does not belong/i);
  });
});

describe('completing an activity', () => {
  it('refuses a second completion, so the timestamp cannot be rewritten', async () => {
    const { service } = build({
      activity: {
        id: 'act-1',
        accountId: 'acc-1',
        opportunityId: null,
        leadId: null,
        completedAt: new Date('2026-07-01'),
      },
    });

    await expect(service.complete(user, 'act-1')).rejects.toThrow(/already completed/i);
  });
});
