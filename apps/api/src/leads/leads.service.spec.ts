import { BadRequestException, ConflictException } from '@nestjs/common';
import { LeadsService } from './leads.service';
import type { AuthenticatedUser } from '../auth/auth.types';

const user: AuthenticatedUser = {
  id: 'user-1',
  email: 'am@afro.example',
  orgUnitId: 'org-1',
  roles: [{ role: 'ACCOUNT_MANAGER', scope: 'GROUP' }],
};

interface LeadShape {
  id: string;
  code: string;
  name: string;
  status: string;
  accountId: string | null;
  convertedOpportunityId: string | null;
}

function build(lead: Partial<LeadShape>) {
  const row: LeadShape = {
    id: 'lead-1',
    code: 'LEAD-2026-000001',
    name: 'Fibre backbone enquiry',
    status: 'NEW',
    accountId: 'acc-1',
    convertedOpportunityId: null,
    ...lead,
  };

  const prisma = {
    lead: {
      findFirst: jest.fn().mockResolvedValue({ ...row, activities: [] }),
      update: jest.fn().mockImplementation(({ data }) => ({ ...row, ...data })),
    },
    contact: { findFirst: jest.fn().mockResolvedValue({ accountId: 'acc-1' }) },
    $transaction: jest.fn(),
  };

  const service = new LeadsService(
    prisma as never,
    { record: jest.fn(), recordUpdate: jest.fn() } as never,
    { next: jest.fn().mockResolvedValue('OPP-2026-000009') } as never,
    { buildFilter: jest.fn().mockResolvedValue({}) } as never,
    { assert: jest.fn().mockResolvedValue({ id: 'acc-1' }) } as never,
    { dispatchEvent: jest.fn() } as never,
  );

  return { service, prisma };
}

describe('lead status changes', () => {
  it('refuses a move the transition table does not allow', async () => {
    const { service } = build({ status: 'QUALIFIED' });

    await expect(
      service.changeStatus(user, 'lead-1', { status: 'NEW' } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('will not disqualify without a reason', async () => {
    const { service } = build({ status: 'WORKING' });

    await expect(
      service.changeStatus(user, 'lead-1', { status: 'DISQUALIFIED' } as never),
    ).rejects.toThrow(/reason/i);
  });

  it('records the reason it was given', async () => {
    const { service, prisma } = build({ status: 'WORKING' });

    await service.changeStatus(user, 'lead-1', {
      status: 'DISQUALIFIED',
      reason: 'Client cancelled the programme',
    } as never);

    expect(prisma.lead.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          disqualifyReason: 'Client cancelled the programme',
        }),
      }),
    );
  });

  it('sends conversion to its own endpoint rather than faking it here', async () => {
    const { service } = build({ status: 'QUALIFIED' });

    await expect(
      service.changeStatus(user, 'lead-1', { status: 'CONVERTED' } as never),
    ).rejects.toThrow(/convert endpoint/i);
  });

  it('treats a closed lead as uneditable', async () => {
    const { service } = build({ status: 'DISQUALIFIED' });

    await expect(
      service.update(user, 'lead-1', { nextStep: 'try again' } as never),
    ).rejects.toThrow(/closed/i);
  });
});

describe('lead conversion', () => {
  it('only promotes a qualified lead', async () => {
    const { service } = build({ status: 'NEW' });

    await expect(service.convert(user, 'lead-1', {} as never)).rejects.toThrow(
      /QUALIFIED/,
    );
  });

  it('refuses to convert twice', async () => {
    const { service } = build({ status: 'QUALIFIED', convertedOpportunityId: 'opp-9' });

    await expect(service.convert(user, 'lead-1', {} as never)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('demands an account when the lead never named one', async () => {
    const { service } = build({ status: 'QUALIFIED', accountId: null });

    await expect(service.convert(user, 'lead-1', {} as never)).rejects.toThrow(
      /names no account/i,
    );
  });

  it('keeps the lead as its own record pointing at the opportunity', async () => {
    const { service, prisma } = build({ status: 'QUALIFIED' });

    const tx = {
      opportunity: {
        create: jest.fn().mockResolvedValue({ id: 'opp-1', code: 'OPP-2026-000009', name: 'x' }),
      },
      opportunityStageHistory: { create: jest.fn() },
      lead: { update: jest.fn().mockResolvedValue({ id: 'lead-1', status: 'CONVERTED' }) },
      activity: { updateMany: jest.fn() },
    };
    prisma.$transaction.mockImplementation((fn: (t: unknown) => unknown) => fn(tx));

    await service.convert(user, 'lead-1', {} as never);

    expect(tx.lead.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'CONVERTED',
          convertedOpportunityId: 'opp-1',
        }),
      }),
    );
    // The lead is never soft-deleted by conversion — the trail must survive.
    expect(prisma.lead.update).not.toHaveBeenCalled();
  });

  it('starts the opportunity at qualification, since that work is already done', async () => {
    const { service, prisma } = build({ status: 'QUALIFIED' });

    const tx = {
      opportunity: {
        create: jest.fn().mockResolvedValue({ id: 'opp-1', code: 'OPP-2026-000009', name: 'x' }),
      },
      opportunityStageHistory: { create: jest.fn() },
      lead: { update: jest.fn().mockResolvedValue({}) },
      activity: { updateMany: jest.fn() },
    };
    prisma.$transaction.mockImplementation((fn: (t: unknown) => unknown) => fn(tx));

    await service.convert(user, 'lead-1', {} as never);

    expect(tx.opportunity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ stage: 'LEAD_QUALIFICATION' }),
      }),
    );
  });

  it('carries the lead\'s activities across to the opportunity', async () => {
    const { service, prisma } = build({ status: 'QUALIFIED' });

    const tx = {
      opportunity: {
        create: jest.fn().mockResolvedValue({ id: 'opp-1', code: 'OPP-2026-000009', name: 'x' }),
      },
      opportunityStageHistory: { create: jest.fn() },
      lead: { update: jest.fn().mockResolvedValue({}) },
      activity: { updateMany: jest.fn() },
    };
    prisma.$transaction.mockImplementation((fn: (t: unknown) => unknown) => fn(tx));

    await service.convert(user, 'lead-1', {} as never);

    expect(tx.activity.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ leadId: 'lead-1' }),
        data: expect.objectContaining({ opportunityId: 'opp-1' }),
      }),
    );
  });
});
