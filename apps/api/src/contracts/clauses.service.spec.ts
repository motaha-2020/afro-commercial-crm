import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ClausesService } from './clauses.service';
import type { AuthenticatedUser } from '../auth/auth.types';

const user: AuthenticatedUser = {
  id: 'user-1',
  email: 'legal@afro.example',
  orgUnitId: 'org-1',
  roles: [{ role: 'LEGAL', scope: 'GROUP' }],
};

const CLAUSE = {
  id: 'cl-1',
  contractId: 'cnt-1',
  clauseType: 'LIABILITY_CAP',
  clauseText: 'Liability is uncapped.',
  riskLevel: 'CRITICAL',
  owner: null,
  mitigation: null,
  isApproved: false,
};

function build({ clause = CLAUSE as unknown, rows = [] as unknown[], contract = { id: 'cnt-1', code: 'CNT-1', contractNumber: 'X', opportunityId: 'opp-1' } as unknown } = {}) {
  const prisma = {
    contract: { findFirst: jest.fn().mockResolvedValue(contract) },
    contractClause: {
      findMany: jest.fn().mockResolvedValue(rows),
      findFirst: jest.fn().mockResolvedValue(clause),
      create: jest.fn().mockImplementation(({ data }) => ({ id: 'cl-1', ...data })),
      update: jest.fn().mockImplementation(({ data }) => ({ ...(clause as object), ...data })),
    },
  };

  const notifications = { dispatchEvent: jest.fn().mockResolvedValue(1) };

  const service = new ClausesService(
    prisma as never,
    { record: jest.fn(), recordUpdate: jest.fn() } as never,
    { assert: jest.fn().mockResolvedValue({ id: 'opp-1' }) } as never,
    notifications as never,
  );

  return { service, prisma, notifications };
}

describe('registering a clause', () => {
  it('never arrives approved, whoever is typing', async () => {
    const { service, prisma } = build();

    await service.add(user, 'cnt-1', {
      clauseType: 'WARRANTY',
      clauseText: '24 months from delivery.',
    } as never);

    expect(prisma.contractClause.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isApproved: false }) }),
    );
  });

  it('tells somebody when a critical clause is registered', async () => {
    const { service, notifications } = build();

    await service.add(user, 'cnt-1', {
      clauseType: 'LIABILITY_CAP',
      clauseText: 'Liability is uncapped.',
      riskLevel: 'CRITICAL',
    } as never);

    expect(notifications.dispatchEvent).toHaveBeenCalledWith(
      'CONTRACT_DEVIATION_CRITICAL',
      expect.objectContaining({ entityType: 'ContractClause' }),
    );
  });

  it('stays quiet for an ordinary clause', async () => {
    const { service, notifications } = build();

    await service.add(user, 'cnt-1', {
      clauseType: 'GOVERNING_LAW',
      clauseText: 'Laws of Egypt.',
      riskLevel: 'LOW',
    } as never);

    expect(notifications.dispatchEvent).not.toHaveBeenCalled();
  });

  it('reports an unknown contract as absent', async () => {
    const { service } = build({ contract: null });

    await expect(
      service.add(user, 'nope', { clauseType: 'SCOPE', clauseText: 'x' } as never),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('approving a clause', () => {
  it('will not sign off a critical clause with nothing written down', async () => {
    const { service } = build();

    await expect(service.approve(user, 'cl-1', {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('accepts one once a mitigation is supplied', async () => {
    const { service, prisma } = build();

    await service.approve(user, 'cl-1', { mitigation: 'Insured to 5M; board informed.' });

    expect(prisma.contractClause.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isApproved: true }),
      }),
    );
  });

  it('does not demand a note for a routine clause', async () => {
    const { service, prisma } = build({
      clause: { ...CLAUSE, riskLevel: 'LOW', clauseType: 'GOVERNING_LAW' },
    });

    await service.approve(user, 'cl-1', {});

    expect(prisma.contractClause.update).toHaveBeenCalled();
  });

  it('refuses to approve twice', async () => {
    const { service } = build({
      clause: { ...CLAUSE, riskLevel: 'LOW', isApproved: true },
    });

    await expect(service.approve(user, 'cl-1', {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('editing an approved clause', () => {
  const approved = { ...CLAUSE, riskLevel: 'LOW', isApproved: true, mitigation: 'n/a' };

  it('re-opens the sign-off when the words change', async () => {
    // Otherwise the register asserts that somebody approved wording they
    // never read.
    const { service, prisma } = build({ clause: approved });

    const result = await service.update(user, 'cl-1', {
      clauseText: 'Liability is capped at contract value.',
    });

    expect(result.reopenedForApproval).toBe(true);
    expect(prisma.contractClause.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isApproved: false }) }),
    );
  });

  it('re-opens it when the risk is re-rated', async () => {
    const { service } = build({ clause: approved });

    const result = await service.update(user, 'cl-1', { riskLevel: 'CRITICAL' });

    expect(result.reopenedForApproval).toBe(true);
  });

  it('leaves it standing when only the owner is corrected', async () => {
    const { service } = build({ clause: approved });

    const result = await service.update(user, 'cl-1', { owner: 'Legal — Cairo' });

    expect(result.reopenedForApproval).toBe(false);
  });
});

describe('reading the register', () => {
  it('opens on what is still owed, riskiest first', async () => {
    const { service } = build({
      rows: [
        { id: 'a', isApproved: true, riskLevel: 'CRITICAL' },
        { id: 'b', isApproved: false, riskLevel: 'LOW' },
        { id: 'c', isApproved: false, riskLevel: 'CRITICAL' },
      ],
    });

    const { items, unapprovedHighRisk } = await service.list(user, 'cnt-1');

    expect(items.map((c) => c.id)).toEqual(['c', 'b', 'a']);
    expect(unapprovedHighRisk).toBe(1);
  });
});
