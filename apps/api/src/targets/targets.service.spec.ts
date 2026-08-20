import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { TargetsService } from './targets.service';
import type { AuthenticatedUser } from '../auth/auth.types';

const asRole = (role: string): AuthenticatedUser => ({
  id: 'user-1',
  email: 'someone@afro.test',
  orgUnitId: 'unit-1',
  roles: [{ role: role as never, scope: 'GROUP' as never }],
});

function build() {
  const created: any[] = [];
  const audited: any[] = [];

  const prisma = {
    salesTarget: {
      findFirst: jest.fn(async () => null),
      findMany: jest.fn(async () => []),
      create: jest.fn(async ({ data }: any) => {
        created.push(data);
        return { id: 't-new', ...data };
      }),
      update: jest.fn(async () => ({})),
    },
    opportunity: { findMany: jest.fn(async () => []) },
  };
  const audit = { record: jest.fn(async (e: any) => void audited.push(e)) };
  const scope = { buildFilter: jest.fn(async () => ({})) };

  const service = new TargetsService(prisma as never, audit as never, scope as never);
  return { service, prisma, audit, audited, created };
}

const validDto = {
  userId: 'rep-1',
  period: 'QUARTER',
  periodStart: '2026-07-01T00:00:00.000Z',
  metric: 'WON_VALUE',
  currency: 'USD',
  value: 1_000_000,
};

describe('who may set a target', () => {
  it('refuses a role that is measured rather than measuring', async () => {
    const { service, created } = build();

    // A salesperson who can set the number they are measured against is not
    // being measured.
    await expect(service.set(asRole('ACCOUNT_MANAGER'), validDto as never)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(created).toHaveLength(0);
  });

  it('records the refused attempt rather than failing silently', async () => {
    const { service, audited } = build();

    await service.set(asRole('PROJECT_MANAGER'), validDto as never).catch(() => undefined);

    expect(audited[0]).toMatchObject({ action: 'SOD_BLOCKED', entityType: 'SalesTarget' });
  });

  it('allows a sales director', async () => {
    const { service, created } = build();

    await service.set(asRole('SALES_DIRECTOR'), validDto as never);

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ metric: 'WON_VALUE', currency: 'USD' });
  });

  it('refuses to delete for a role that may not set', async () => {
    const { service } = build();

    await expect(service.remove(asRole('ACCOUNT_MANAGER'), 't1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe('a target that would not mean anything', () => {
  const director = asRole('CEO');

  it('refuses a row naming both a person and a unit', async () => {
    const { service } = build();

    // Counted twice the moment anybody rolls the numbers up.
    await expect(
      service.set(director, { ...validDto, orgUnitId: 'unit-9' } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a row naming neither', async () => {
    const { service } = build();

    await expect(
      service.set(director, { ...validDto, userId: undefined } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a target of zero', async () => {
    const { service } = build();

    await expect(service.set(director, { ...validDto, value: 0 } as never)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('refuses a money target with no currency', async () => {
    const { service } = build();

    await expect(
      service.set(director, { ...validDto, currency: undefined } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('stores no currency on a count target even when one is sent', async () => {
    const { service, created } = build();

    await service.set(director, {
      ...validDto,
      metric: 'WON_COUNT',
      currency: 'USD',
      value: 12,
    } as never);

    // A count in USD is not a thing; keeping the field would invite a screen
    // to print it.
    expect(created[0].currency).toBeNull();
  });
});

describe('superseding rather than overwriting', () => {
  it('retires the previous target for the same owner, period and metric', async () => {
    const { service, prisma } = build();
    prisma.salesTarget.findFirst = jest.fn(async () => ({ id: 't-old', value: 500_000 })) as never;

    await service.set(asRole('CEO'), validDto as never);

    // A quarter that has closed must stay explainable against the number that
    // applied while it was open.
    expect(prisma.salesTarget.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 't-old' } }),
    );
    expect(prisma.salesTarget.create).toHaveBeenCalled();
  });
});
