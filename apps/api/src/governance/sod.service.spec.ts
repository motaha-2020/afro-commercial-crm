import { ForbiddenException } from '@nestjs/common';
import { SodService } from './sod.service';
import type { AuthenticatedUser } from '../auth/auth.types';

const actor: AuthenticatedUser = {
  id: 'user-1',
  email: 'creator@afro.example',
  orgUnitId: 'org-1',
  // Two roles on purpose: rule 7 exists precisely because accumulating roles
  // must not dissolve a conflict of interest.
  roles: [
    { role: 'ACCOUNT_MANAGER', scope: 'OWN' },
    { role: 'FINANCE', scope: 'COUNTRY' },
  ],
};

function build(originatorId: string | null) {
  const prisma = {
    auditLog: {
      findFirst: jest
        .fn()
        .mockResolvedValue(originatorId ? { userId: originatorId } : null),
    },
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  return {
    service: new SodService(prisma as never, audit as never),
    prisma,
    audit,
  };
}

describe('SodService', () => {
  it('blocks the actor who originated the record', async () => {
    const { service, audit } = build(actor.id);

    await expect(
      service.assertSeparation('SOD_05', 'Account', 'acc-1', actor),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SOD_BLOCKED', entityId: 'acc-1' }),
    );
  });

  it('names the violated rule in the error, for the user and the auditor', async () => {
    const { service } = build(actor.id);

    await expect(
      service.assertSeparation('SOD_05', 'Account', 'acc-1', actor),
    ).rejects.toMatchObject({ response: { sodRule: 'SOD_05' } });
  });

  it('lets a different user act, and records nothing', async () => {
    const { service, audit } = build('someone-else');

    await expect(
      service.assertSeparation('SOD_05', 'Account', 'acc-1', actor),
    ).resolves.toBeUndefined();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('does not block when no originator is on record', async () => {
    // Seeded and migrated records have no CREATE entry. Blocking everyone on an
    // unprovable conflict would make historical data unmanageable; the trail,
    // not a guess, is the evidence.
    const { service } = build(null);

    await expect(
      service.assertSeparation('SOD_05', 'Account', 'legacy-1', actor),
    ).resolves.toBeUndefined();
  });

  it('reports blocking rules without throwing, so the UI can hide the action', async () => {
    const { service } = build(actor.id);

    await expect(service.blockingRules('Account', 'acc-1', actor)).resolves.toEqual(
      expect.arrayContaining(['SOD_05', 'SOD_07']),
    );
  });

  it('reports nothing blocking for an actor who did not create the record', async () => {
    const { service } = build('someone-else');

    await expect(service.blockingRules('Account', 'acc-1', actor)).resolves.toEqual([]);
  });
});
