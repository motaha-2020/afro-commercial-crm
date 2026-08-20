import type { AuthenticatedUser } from '../../auth/auth.types';

/**
 * A fixed, deliberately awkward book of business for the simulation.
 *
 * Every awkward part is here on purpose. Two users see different subsets of
 * the same rows, so a leak shows up as a number rather than as a judgement
 * call. Two currencies sit side by side, so any answer that adds them is
 * visibly wrong. And three opportunities are unpriced for three different
 * reasons, so an answer that says "zero" can be told from one that says
 * "not costed".
 */

export const PM: AuthenticatedUser = {
  id: 'user-pm',
  email: 'pm@afro.test',
  orgUnitId: 'unit-eg',
  roles: [{ role: 'PROJECT_MANAGER' as never, scope: 'OWN' as never }],
};

export const CEO: AuthenticatedUser = {
  id: 'user-ceo',
  email: 'ceo@afro.test',
  orgUnitId: 'unit-group',
  roles: [{ role: 'CEO' as never, scope: 'GROUP' as never }],
};

export interface FixtureOpportunity {
  id: string;
  code: string;
  name: string;
  ownerId: string;
  stage: string;
  status: string;
  forecastCategory: string;
  health: string;
  country: string;
  currency: string;
  estimatedValue: string | null;
  proposedPrice: string | null;
  marginPercent: string | null;
  probability: number | null;
  expectedCloseDate: Date | null;
  submissionDate: Date | null;
  nextStep: string | null;
  account: { legalName: string };
  owner: { fullNameAr: string; fullNameEn: string };
}

const opp = (o: Partial<FixtureOpportunity> & { id: string; code: string; ownerId: string }): FixtureOpportunity => ({
  name: 'مشروع',
  stage: 'COSTING_SOURCING',
  status: 'ACTIVE',
  forecastCategory: 'PIPELINE',
  health: 'GREEN',
  country: 'EG',
  currency: 'USD',
  estimatedValue: '100000',
  proposedPrice: null,
  marginPercent: null,
  probability: 40,
  expectedCloseDate: new Date('2026-11-30'),
  submissionDate: null,
  nextStep: null,
  account: { legalName: 'شركة النيل للمقاولات' },
  owner: { fullNameAr: 'مدير المشروع', fullNameEn: 'Project Manager' },
  ...o,
});

/** Four owned by the PM, three owned elsewhere — the CEO sees all seven. */
export const OPPORTUNITIES: FixtureOpportunity[] = [
  opp({
    id: 'opp-1',
    code: 'OPP-2026-000289',
    ownerId: PM.id,
    name: 'توريد معدات محطة المعالجة',
    stage: 'BID_STRATEGY_SOLUTION',
    estimatedValue: '450000',
    proposedPrice: '520000',
    marginPercent: '18.50',
  }),
  opp({
    id: 'opp-2',
    code: 'OPP-2026-000290',
    ownerId: PM.id,
    name: 'صيانة الشبكة الكهربائية',
    estimatedValue: '120000',
    health: 'AMBER',
  }),
  opp({
    id: 'opp-3',
    code: 'OPP-2026-000291',
    ownerId: PM.id,
    name: 'مشروع السودان للطرق',
    country: 'SD',
    currency: 'EGP',
    estimatedValue: '3000000',
    // Deliberately a second currency: any total that merges it with USD is
    // wrong in a way that is easy to see.
  }),
  opp({
    id: 'opp-4',
    code: 'OPP-2026-000292',
    ownerId: PM.id,
    name: 'عقد إطاري بلا تقدير',
    // No estimated value at all — absence, not zero.
    estimatedValue: null,
    probability: null,
    expectedCloseDate: null,
    status: 'ON_HOLD',
  }),
  opp({
    id: 'opp-5',
    code: 'OPP-2026-000293',
    ownerId: 'user-other',
    name: 'مشروع فريق آخر',
    estimatedValue: '800000',
  }),
  opp({
    id: 'opp-6',
    code: 'OPP-2026-000294',
    ownerId: 'user-other',
    name: 'مناقصة الإسكندرية',
    estimatedValue: '250000',
    stage: 'PROPOSAL_SUBMISSION',
    submissionDate: new Date('2026-09-15'),
  }),
  opp({
    id: 'opp-7',
    code: 'OPP-2026-000295',
    ownerId: 'user-other',
    name: 'صفقة خاسرة',
    status: 'LOST',
    estimatedValue: '90000',
  }),
];

/** Only opp-1 is costed. The rest are unpriced, and that is not zero. */
export const COSTING_SCENARIOS: Record<string, any> = {
  'opp-1': {
    name: 'السيناريو الأساسي',
    currency: 'USD',
    isSelected: true,
    versions: [
      {
        versionNumber: 3,
        status: 'APPROVED',
        totalCost: '423800',
        totalPrice: '520000',
        marginPercent: '18.50',
        lockedAt: new Date('2026-08-10'),
      },
    ],
  },
  // opp-2 has a scenario with no priced version — different from having none.
  'opp-2': {
    name: 'مسودة',
    currency: 'USD',
    isSelected: true,
    versions: [
      { versionNumber: 1, status: 'DRAFT', totalCost: null, totalPrice: null, marginPercent: null },
    ],
  },
  // opp-3 raises when read: a costing that cannot be read is its own state.
  'opp-3': '__THROW__',
};

export function visibleTo(user: AuthenticatedUser): FixtureOpportunity[] {
  // Mirrors DataScopeService: GROUP sees everything, OWN sees only its own.
  const scope = user.roles[0]?.scope as string;
  return scope === 'GROUP' ? OPPORTUNITIES : OPPORTUNITIES.filter((o) => o.ownerId === user.id);
}
