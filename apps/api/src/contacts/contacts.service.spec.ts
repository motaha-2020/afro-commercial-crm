import { BadRequestException } from '@nestjs/common';
import { ContactsService } from './contacts.service';
import type { AuthenticatedUser } from '../auth/auth.types';

const user: AuthenticatedUser = {
  id: 'user-1',
  email: 'am@afro.example',
  orgUnitId: 'org-1',
  roles: [{ role: 'ACCOUNT_MANAGER', scope: 'GROUP' }],
};

function build(primaryForCount = 0) {
  const tx = {
    contact: {
      updateMany: jest.fn(),
      create: jest.fn().mockImplementation(({ data }) => ({ id: 'con-1', ...data })),
      update: jest.fn().mockImplementation(({ data }) => ({ id: 'con-1', ...data })),
    },
  };

  const prisma = {
    contact: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'con-1',
        accountId: 'acc-1',
        fullName: 'Amina Kone',
        isPrimary: false,
        roles: [],
      }),
    },
    contactRole: {
      upsert: jest.fn().mockResolvedValue({ id: 'role-1', roleCode: 'CHAMPION' }),
      findFirst: jest.fn().mockResolvedValue({ id: 'role-1' }),
      update: jest.fn(),
    },
    opportunity: { count: jest.fn().mockResolvedValue(primaryForCount) },
    $transaction: jest.fn().mockImplementation((fn: (t: unknown) => unknown) => fn(tx)),
  };

  const service = new ContactsService(
    prisma as never,
    { record: jest.fn(), recordUpdate: jest.fn() } as never,
    { buildFilter: jest.fn().mockResolvedValue({}) } as never,
    {
      assert: jest.fn().mockResolvedValue({ id: 'acc-1' }),
      assertContact: jest.fn().mockResolvedValue({ id: 'con-1', accountId: 'acc-1' }),
    } as never,
  );

  return { service, prisma, tx };
}

describe('primary contact', () => {
  it('demotes the incumbent, because only one can be primary', async () => {
    const { service, tx } = build();

    await service.create(user, {
      accountId: 'acc-1',
      fullName: 'Amina Kone',
      isPrimary: true,
    } as never);

    expect(tx.contact.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ accountId: 'acc-1', isPrimary: true }),
        data: { isPrimary: false },
      }),
    );
  });

  it('leaves the incumbent alone when the new contact is not primary', async () => {
    const { service, tx } = build();

    await service.create(user, {
      accountId: 'acc-1',
      fullName: 'Amina Kone',
    } as never);

    expect(tx.contact.updateMany).not.toHaveBeenCalled();
  });
});

describe('contact roles', () => {
  it('revives a previously removed role rather than duplicating it', async () => {
    const { service, prisma } = build();

    await service.addRole(user, 'con-1', { roleCode: 'CHAMPION' } as never);

    expect(prisma.contactRole.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ deletedAt: null }) }),
    );
  });

  it('removes a role softly', async () => {
    const { service, prisma } = build();

    await service.removeRole(user, 'con-1', 'CHAMPION');

    expect(prisma.contactRole.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { deletedAt: expect.any(Date) } }),
    );
  });
});

describe('removing a contact', () => {
  it('will not orphan an opportunity that names them as its primary contact', async () => {
    const { service } = build(1);

    await expect(service.remove(user, 'con-1')).rejects.toBeInstanceOf(BadRequestException);
  });
});
