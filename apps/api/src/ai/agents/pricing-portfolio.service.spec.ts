import { PricingPortfolioService } from './pricing-portfolio.service';
import type { AuthenticatedUser } from '../../auth/auth.types';

const user: AuthenticatedUser = {
  id: 'user-1',
  email: 'pm@afro.test',
  orgUnitId: 'unit-1',
  roles: [{ role: 'PROJECT_MANAGER' as never, scope: 'OWN' as never }],
};

const opp = (code: string) => ({
  id: `id-${code}`,
  code,
  name: `فرصة ${code}`,
  currency: 'USD',
  account: { legalName: 'شركة النيل' },
});

function build(opportunities: any[], scenarioFor: (opportunityId: string) => any) {
  const prisma = {
    costingScenario: {
      findFirst: jest.fn(async ({ where }: any) => scenarioFor(where.opportunityId)),
    },
  };
  const opportunitiesService = {
    list: jest.fn(async () => ({ items: opportunities, total: opportunities.length })),
  };
  return new PricingPortfolioService(prisma as never, opportunitiesService as never);
}

const pricedScenario = (margin: string) => ({
  name: 'الأساسي',
  currency: 'USD',
  versions: [{ status: 'APPROVED', totalCost: '800', totalPrice: '1000', marginPercent: margin }],
});

describe('PricingPortfolioService', () => {
  it('keeps priced, unpriced and unreadable as three distinct outcomes', async () => {
    const service = build(
      [opp('OPP-1'), opp('OPP-2'), opp('OPP-3')],
      (id) => {
        if (id === 'id-OPP-1') return pricedScenario('20');
        if (id === "id-OPP-2") return null; // never costed
        throw new Error('forbidden');
      },
    );

    const { facts, rows } = await service.summarise(user);

    expect(facts.priced).toBe(1);
    expect(facts.unpriced).toBe(1);
    expect(facts.unreadable).toBe(1);
    expect(rows.map((r) => r.state).sort()).toEqual(['priced', 'unpriced', 'unreadable']);
  });

  it('never reports an absent margin as zero', async () => {
    const service = build([opp('OPP-1')], () => null);

    const { facts, rows } = await service.summarise(user);

    // No opportunity is priced, so there is no margin range at all — and a
    // range of zero would be read as "our margins are zero", which is a claim.
    expect(facts.marginRange).toBeNull();
    expect(facts.costByCurrency).toBeNull();
    expect(rows[0].marginPercent).toBeNull();
  });

  it('reports opportunities beyond the cap as unread, with the reason', async () => {
    const many = Array.from({ length: 45 }, (_, i) => opp(`OPP-${i}`));
    const service = build(many, () => pricedScenario('15'));

    const { facts } = await service.summarise(user);

    expect(facts.opportunitiesConsidered).toBe(40);
    expect(facts.notRead).toBe(5);
    expect(String(facts.notReadReason)).toContain('5');
    // Unread is its own state — it must not inflate any of the other three.
    expect(Number(facts.priced) + Number(facts.unpriced) + Number(facts.unreadable)).toBe(40);
  });

  it('sums each currency separately and never converts between them', async () => {
    const service = build([opp('OPP-1'), opp('OPP-2')], (id) => ({
      ...pricedScenario('20'),
      currency: id === 'id-OPP-1' ? 'USD' : 'EGP',
    }));

    const { facts } = await service.summarise(user);

    expect(facts.costByCurrency).toEqual({ USD: '800.00', EGP: '800.00' });
  });

  it('states how many priced opportunities the margin range actually covers', async () => {
    const service = build([opp('OPP-1'), opp('OPP-2')], (id) => ({
      ...pricedScenario('20'),
      versions: [
        {
          status: 'APPROVED',
          totalCost: '800',
          totalPrice: '1000',
          // One priced opportunity carries no margin figure at all.
          marginPercent: id === 'id-OPP-1' ? '20' : null,
        },
      ],
    }));

    const { facts } = await service.summarise(user);

    expect(facts.marginRange).toEqual({
      lowest: '20.00',
      highest: '20.00',
      basedOn: 1,
      ofPriced: 2,
    });
  });
});
