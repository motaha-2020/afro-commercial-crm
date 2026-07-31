/**
 * Seeds a minimal but coherent starting point: an org tree, a handful of users
 * across roles, a few real-looking Afro accounts, and opportunities spread
 * across the pipeline. Idempotent — safe to run repeatedly.
 *
 * Passwords are read from SEED_PASSWORD (falls back to a clearly-temporary
 * default that must be changed). This is sample data, not production identities.
 */
import { PrismaClient, type Role } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'ChangeMe#2026';

async function main() {
  const passwordHash = await argon2.hash(SEED_PASSWORD);

  // --- Organization tree: Group > Egypt entity > Telecom BU ---
  const group = await prisma.organizationUnit.upsert({
    where: { code: 'AFRO-GROUP' },
    update: {},
    create: {
      code: 'AFRO-GROUP',
      nameAr: 'مجموعة أفرو',
      nameEn: 'Afro Group',
      nameFr: 'Groupe Afro',
      type: 'GROUP',
    },
  });

  const egypt = await prisma.organizationUnit.upsert({
    where: { code: 'AFRO-EG' },
    update: {},
    create: {
      code: 'AFRO-EG',
      nameAr: 'أفرو مصر',
      nameEn: 'Afro Egypt',
      nameFr: 'Afro Égypte',
      type: 'LEGAL_ENTITY',
      country: 'EG',
      currency: 'EGP',
      parentId: group.id,
    },
  });

  const telecomBu = await prisma.organizationUnit.upsert({
    where: { code: 'AFRO-EG-TELECOM' },
    update: {},
    create: {
      code: 'AFRO-EG-TELECOM',
      nameAr: 'قطاع الاتصالات',
      nameEn: 'Telecom Business Unit',
      nameFr: 'Unité Télécom',
      type: 'BUSINESS_UNIT',
      country: 'EG',
      parentId: egypt.id,
    },
  });

  // --- Users ---
  const users: {
    email: string;
    ar: string;
    en: string;
    role: Role;
    scope: 'OWN' | 'GROUP' | 'BUSINESS_UNIT';
    orgUnitId: string;
  }[] = [
    { email: 'ceo@afro.example', ar: 'الرئيس التنفيذي', en: 'Chief Executive', role: 'CEO', scope: 'GROUP', orgUnitId: group.id },
    { email: 'sales.director@afro.example', ar: 'مدير المبيعات', en: 'Sales Director', role: 'SALES_DIRECTOR', scope: 'BUSINESS_UNIT', orgUnitId: telecomBu.id },
    { email: 'am@afro.example', ar: 'مدير حساب', en: 'Account Manager', role: 'ACCOUNT_MANAGER', scope: 'OWN', orgUnitId: telecomBu.id },
    { email: 'estimation@afro.example', ar: 'مهندس تكاليف', en: 'Estimation Engineer', role: 'ESTIMATION', scope: 'BUSINESS_UNIT', orgUnitId: telecomBu.id },
    { email: 'finance@afro.example', ar: 'المدير المالي', en: 'Finance', role: 'FINANCE', scope: 'GROUP', orgUnitId: group.id },
    { email: 'admin@afro.example', ar: 'مدير النظام', en: 'System Admin', role: 'SYSTEM_ADMIN', scope: 'GROUP', orgUnitId: group.id },
  ];

  const created: Record<string, string> = {};
  for (const u of users) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: {
        email: u.email,
        passwordHash,
        fullNameAr: u.ar,
        fullNameEn: u.en,
        orgUnitId: u.orgUnitId,
        roles: { create: { role: u.role, scope: u.scope } },
      },
    });
    created[u.role] = user.id;
  }

  const amId = created['ACCOUNT_MANAGER'];

  // --- Accounts (drawn from the prototype's sample set) ---
  const accountSeeds = [
    { code: 'ACC-2026-000001', legalName: 'Sudanese Telecom (STE)', type: 'OPERATOR' as const, country: 'EG', industry: 'FTTH' as const },
    { code: 'ACC-2026-000002', legalName: 'Madagascar Fiber Co.', type: 'OPERATOR' as const, country: 'MG', industry: 'FTTH' as const },
    { code: 'ACC-2026-000003', legalName: 'East Africa Mobile', type: 'OPERATOR' as const, country: 'KE', industry: 'WIRELESS' as const },
    { code: 'ACC-2026-000004', legalName: 'Comoros Digital', type: 'GOVERNMENT' as const, country: 'KM', industry: 'FIXED' as const },
  ];

  const accountIds: string[] = [];
  for (const a of accountSeeds) {
    const account = await prisma.account.upsert({
      where: { code: a.code },
      update: {},
      create: {
        ...a,
        ownerId: amId,
        orgUnitId: telecomBu.id,
        paymentTermDays: 90,
      },
    });
    accountIds.push(account.id);
  }

  // --- Opportunities across the pipeline ---
  const oppSeeds = [
    { code: 'OPP-2026-000001', name: 'FTTH Rollout — 120 Cabinets', stage: 'COSTING_SOURCING' as const, industry: 'FTTH' as const, country: 'EG', value: 4200000, accountIdx: 0 },
    { code: 'OPP-2026-000002', name: 'Wireless Backhaul Expansion', stage: 'SCOPE_DISCOVERY' as const, industry: 'WIRELESS' as const, country: 'KE', value: 1800000, accountIdx: 2 },
    { code: 'OPP-2026-000003', name: 'National Fiber Backbone', stage: 'PROPOSAL_SUBMISSION' as const, industry: 'FIXED' as const, country: 'MG', value: 9500000, accountIdx: 1 },
    { code: 'OPP-2026-000004', name: 'Government Network Modernization', stage: 'LEAD_QUALIFICATION' as const, industry: 'FIXED' as const, country: 'KM', value: 2600000, accountIdx: 3 },
  ];

  for (const o of oppSeeds) {
    const exists = await prisma.opportunity.findUnique({ where: { code: o.code } });
    if (exists) continue;
    const opp = await prisma.opportunity.create({
      data: {
        code: o.code,
        name: o.name,
        accountId: accountIds[o.accountIdx],
        country: o.country,
        industry: o.industry,
        currency: 'USD',
        estimatedValue: o.value,
        stage: o.stage,
        status: 'ACTIVE',
        forecastCategory: 'PIPELINE',
        health: 'GREEN',
        ownerId: amId,
        orgUnitId: telecomBu.id,
      },
    });
    await prisma.opportunityStageHistory.create({
      data: {
        opportunityId: opp.id,
        fromStage: null,
        toStage: o.stage,
        changedById: amId,
        reason: 'Seed',
      },
    });
  }

  console.log('Seed complete.');
  console.log(`Users created with password: ${SEED_PASSWORD}`);
  console.log('Sign in as: ceo@afro.example / am@afro.example / admin@afro.example');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
