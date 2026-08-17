import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RelationshipsService } from './relationships.service';
import type { AuthenticatedUser } from '../auth/auth.types';

const user: AuthenticatedUser = {
  id: 'user-1',
  email: 'am@afro.example',
  orgUnitId: 'org-1',
  roles: [{ role: 'ACCOUNT_MANAGER', scope: 'GROUP' }],
};

const card = (id: string, name: string) => ({
  id,
  code: id.toUpperCase(),
  legalName: name,
  tradeName: null,
  country: 'EG',
  type: 'CUSTOMER',
});

/**
 * @param visible ids the caller is allowed to see; anything else answers 404
 *                the way the real gate does.
 */
function build({
  rows = [] as unknown[],
  mirrored = null as unknown,
  visible = ['acc-1', 'acc-2'],
} = {}) {
  const accounts = {
    assert: jest.fn().mockImplementation(async (_u: unknown, id: string) => {
      if (!visible.includes(id)) throw new NotFoundException('Account not found');
      return { id };
    }),
  };

  const prisma = {
    accountRelationship: {
      findMany: jest.fn().mockResolvedValue(rows),
      findFirst: jest.fn().mockResolvedValue(mirrored),
      upsert: jest.fn().mockImplementation(({ create }) => ({ id: 'rel-1', ...create })),
      update: jest.fn().mockImplementation(({ data }) => ({ id: 'rel-1', ...data })),
    },
  };

  const service = new RelationshipsService(
    prisma as never,
    { record: jest.fn(), recordUpdate: jest.fn() } as never,
    accounts as never,
  );

  return { service, prisma, accounts };
}

describe('recording a relationship', () => {
  it('checks the far account too, so an id you cannot see cannot be named', async () => {
    const { service, accounts } = build({ visible: ['acc-1'] });

    await expect(
      service.create(user, 'acc-1', { toId: 'acc-9', typeCode: 'PARENT' } as never),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(accounts.assert).toHaveBeenCalledWith(user, 'acc-9');
  });

  it('refuses to relate an account to itself', async () => {
    const { service } = build();

    await expect(
      service.create(user, 'acc-1', { toId: 'acc-1', typeCode: 'JV_PARTNER' } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses the duplicate that is the same fact written from the other end', async () => {
    // acc-2 is already recorded as acc-1's subsidiary; recording acc-1 as
    // acc-2's parent would be one fact in two rows that can later disagree.
    const { service, prisma } = build({ mirrored: { id: 'rel-existing' } });

    await expect(
      service.create(user, 'acc-1', { toId: 'acc-2', typeCode: 'SUBSIDIARY' } as never),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.accountRelationship.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          fromId: 'acc-2',
          toId: 'acc-1',
          typeCode: 'PARENT',
        }),
      }),
    );
  });

  it('revives a removed link rather than colliding on the unique triple', async () => {
    const { service, prisma } = build();

    await service.create(user, 'acc-1', { toId: 'acc-2', typeCode: 'PARENT' } as never);

    expect(prisma.accountRelationship.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ deletedAt: null }) }),
    );
  });
});

describe('reading relationships from either end', () => {
  const stored = {
    id: 'rel-1',
    fromId: 'acc-1',
    toId: 'acc-2',
    typeCode: 'PARENT',
    notes: null,
    createdAt: new Date('2026-01-01'),
    from: card('acc-1', 'Afro Holding'),
    to: card('acc-2', 'Afro Egypt'),
  };

  it('reads outgoing links as stored', async () => {
    const { service } = build({ rows: [stored] });

    const { items } = await service.list(user, 'acc-1');

    expect(items).toHaveLength(1);
    expect(items[0].typeCode).toBe('PARENT');
    expect(items[0].isOutgoing).toBe(true);
    expect(items[0].counterparty.id).toBe('acc-2');
  });

  it('flips the same row when read from the other account', async () => {
    // Without this, a subsidiary's own file would never mention its parent.
    const { service } = build({ rows: [stored] });

    const { items } = await service.list(user, 'acc-2');

    expect(items[0].typeCode).toBe('SUBSIDIARY');
    expect(items[0].isOutgoing).toBe(false);
    expect(items[0].counterparty.id).toBe('acc-1');
  });

  it('drops a link whose far end is out of scope, name and all', async () => {
    const { service } = build({ rows: [stored], visible: ['acc-1'] });

    const { items, total } = await service.list(user, 'acc-1');

    expect(items).toEqual([]);
    expect(total).toBe(0);
  });

  it('asks the scope gate once per counterparty, not once per row', async () => {
    const second = { ...stored, id: 'rel-2', typeCode: 'MAIN_CONTRACTOR' };
    const { service, accounts } = build({ rows: [stored, second] });

    await service.list(user, 'acc-1');

    // Once for the account being read, once for the shared counterparty.
    expect(accounts.assert.mock.calls.filter((c) => c[1] === 'acc-2')).toHaveLength(1);
  });
});
