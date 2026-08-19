/**
 * Seeds a minimal but coherent starting point: an org tree, users across roles,
 * a few real-looking Afro accounts, and opportunities spread across the
 * pipeline. Idempotent — every write is an upsert, so it is safe to re-run.
 *
 * Plain ESM JavaScript on purpose: it runs with `node prisma/seed.mjs` and no
 * TypeScript toolchain, so it works identically in the container and locally.
 *
 * Passwords come from SEED_PASSWORD (falls back to a clearly-temporary value
 * that must be changed). This is sample data, not production identities.
 */
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

const prisma = new PrismaClient();
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'ChangeMe#2026';

async function main() {
  const passwordHash = await argon2.hash(SEED_PASSWORD);

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

  const users = [
    { email: 'ceo@afro.example', ar: 'الرئيس التنفيذي', en: 'Chief Executive', role: 'CEO', scope: 'GROUP', orgUnitId: group.id },
    { email: 'sales.director@afro.example', ar: 'مدير المبيعات', en: 'Sales Director', role: 'SALES_DIRECTOR', scope: 'BUSINESS_UNIT', orgUnitId: telecomBu.id },
    { email: 'am@afro.example', ar: 'مدير حساب', en: 'Account Manager', role: 'ACCOUNT_MANAGER', scope: 'OWN', orgUnitId: telecomBu.id },
    { email: 'estimation@afro.example', ar: 'مهندس تكاليف', en: 'Estimation Engineer', role: 'ESTIMATION', scope: 'BUSINESS_UNIT', orgUnitId: telecomBu.id },
    { email: 'finance@afro.example', ar: 'المدير المالي', en: 'Finance', role: 'FINANCE', scope: 'GROUP', orgUnitId: group.id },
    { email: 'admin@afro.example', ar: 'مدير النظام', en: 'System Admin', role: 'SYSTEM_ADMIN', scope: 'GROUP', orgUnitId: group.id },
  ];

  const created = {};
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

  const accountSeeds = [
    { code: 'ACC-2026-000001', legalName: 'Sudanese Telecom (STE)', type: 'OPERATOR', country: 'EG', industry: 'FTTH' },
    { code: 'ACC-2026-000002', legalName: 'Madagascar Fiber Co.', type: 'OPERATOR', country: 'MG', industry: 'FTTH' },
    { code: 'ACC-2026-000003', legalName: 'East Africa Mobile', type: 'OPERATOR', country: 'KE', industry: 'WIRELESS' },
    { code: 'ACC-2026-000004', legalName: 'Comoros Digital', type: 'GOVERNMENT', country: 'KM', industry: 'FIXED' },
  ];

  const accountIds = [];
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

  const oppSeeds = [
    { code: 'OPP-2026-000001', name: 'FTTH Rollout — 120 Cabinets', stage: 'COSTING_SOURCING', industry: 'FTTH', country: 'EG', value: 4200000, accountIdx: 0 },
    { code: 'OPP-2026-000002', name: 'Wireless Backhaul Expansion', stage: 'SCOPE_DISCOVERY', industry: 'WIRELESS', country: 'KE', value: 1800000, accountIdx: 2 },
    { code: 'OPP-2026-000003', name: 'National Fiber Backbone', stage: 'PROPOSAL_SUBMISSION', industry: 'FIXED', country: 'MG', value: 9500000, accountIdx: 1 },
    { code: 'OPP-2026-000004', name: 'Government Network Modernization', stage: 'LEAD_QUALIFICATION', industry: 'FIXED', country: 'KM', value: 2600000, accountIdx: 3 },
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

  // Default notification rules. Without a rule an event reaches nobody, so the
  // governance-relevant ones ship configured rather than waiting for an admin
  // to discover the feature exists.
  const ruleSeeds = [
    { eventType: 'OPPORTUNITY_STAGE_CHANGED', roleTarget: 'SALES_DIRECTOR' },
    { eventType: 'OPPORTUNITY_STAGE_CHANGED', roleTarget: 'CEO' },
    { eventType: 'OPPORTUNITY_STATUS_CHANGED', roleTarget: 'SALES_DIRECTOR' },
    { eventType: 'ACCOUNT_CREDIT_CHANGED', roleTarget: 'FINANCE' },
    { eventType: 'LEAD_CONVERTED', roleTarget: 'SALES_DIRECTOR' },
    { eventType: 'PARTNER_STATUS_CHANGED', roleTarget: 'PROCUREMENT' },
    { eventType: 'PARTNER_BLACKLISTED', roleTarget: 'PROCUREMENT' },
    { eventType: 'PARTNER_BLACKLISTED', roleTarget: 'CEO' },
    { eventType: 'RFQ_ISSUED', roleTarget: 'PROCUREMENT' },
    { eventType: 'QUOTATION_SELECTED', roleTarget: 'PROCUREMENT' },
    { eventType: 'QUOTATION_SELECTED', roleTarget: 'ESTIMATION' },
    // Before it lapses, not after: an offer that expires unnoticed takes a
    // column out of the comparison and nobody is told why.
    { eventType: 'QUOTATION_EXPIRING', roleTarget: 'PROCUREMENT' },
    { eventType: 'QUOTATION_EXPIRING', roleTarget: 'ESTIMATION' },
    { eventType: 'BID_DECISION_RECORDED', roleTarget: 'CEO' },
    { eventType: 'BID_DECISION_RECORDED', roleTarget: 'SALES_DIRECTOR' },
    { eventType: 'BID_STATUS_CHANGED', roleTarget: 'SALES_DIRECTOR' },
    { eventType: 'COSTING_SUBMITTED', roleTarget: 'FINANCE' },
    { eventType: 'COSTING_APPROVED', roleTarget: 'SALES_DIRECTOR' },
    { eventType: 'COSTING_REJECTED', roleTarget: 'ESTIMATION' },
  ];

  for (const r of ruleSeeds) {
    const exists = await prisma.notificationRule.findFirst({
      where: { eventType: r.eventType, roleTarget: r.roleTarget, deletedAt: null },
    });
    if (!exists) await prisma.notificationRule.create({ data: r });
  }

  // Bid/No-Bid scoring weights — the spec's indicative split (وزن استرشادي).
  // Seeded rather than left implicit so the numbers in force are visible and
  // auditable from day one; commercial management can retune them, but only
  // to another set totalling 100.
  const weightSeeds = [
    ['RELATIONSHIP_STRENGTH', 15],
    ['TECHNICAL_FIT', 15],
    ['DELIVERY_CAPACITY', 15],
    ['EXPECTED_PROFITABILITY', 15],
    ['PAYMENT_TERMS', 10],
    ['COMPETITION', 10],
    ['SCOPE_CLARITY', 10],
    ['STRATEGIC_VALUE', 10],
  ];

  for (const [factor, weight] of weightSeeds) {
    await prisma.bidScoringWeight.upsert({
      where: { factor },
      update: {},
      create: { factor, weight },
    });
  }

  // Cost Element Library. The spec replaces free-text cost lines with a
  // controlled list precisely so two bids can be compared; seeding the FTTH
  // essentials means the first costing has something to point at.
  const elementSeeds = [
    ['MAT-CABLE', 'DIRECT_MATERIAL', 'كابل ألياف', 'Fiber cable'],
    ['MAT-CABINET', 'DIRECT_MATERIAL', 'كابينة', 'Cabinet'],
    ['MAT-DUCT', 'DIRECT_MATERIAL', 'مواسير', 'Duct'],
    ['MAT-ACC', 'DIRECT_MATERIAL', 'مستلزمات', 'Accessories'],
    ['LAB-SPLICER', 'DIRECT_LABOR', 'فني لحام', 'Splicer'],
    ['LAB-TECH', 'DIRECT_LABOR', 'فني', 'Technician'],
    ['LAB-ENG', 'DIRECT_LABOR', 'مهندس', 'Engineer'],
    ['EQP-EXCAVATOR', 'EQUIPMENT', 'حفار', 'Excavator'],
    ['EQP-OTDR', 'EQUIPMENT', 'جهاز OTDR', 'OTDR'],
    ['EQP-SPLICER', 'EQUIPMENT', 'ماكينة لحام', 'Fusion splicer'],
    ['VEH-PICKUP', 'VEHICLE', 'سيارة نقل', 'Pickup'],
    ['SUB-CIVIL', 'SUBCONTRACTOR', 'أعمال مدنية', 'Civil works'],
    ['SUB-INSTALL', 'SUBCONTRACTOR', 'تركيبات', 'Installation'],
    ['IND-PM', 'INDIRECT_COST', 'إدارة المشروع', 'Project management'],
    ['IND-HSE', 'INDIRECT_COST', 'السلامة والصحة', 'HSE'],
    ['FIN-GUARANTEE', 'FINANCIAL_COST', 'خطاب ضمان', 'Bank guarantee'],
    ['COR-GA', 'CORPORATE', 'مصروفات عمومية', 'G&A'],
    ['COR-CONT', 'CORPORATE', 'احتياطي', 'Contingency'],
    ['PRF-MARGIN', 'PROFIT', 'هامش الربح', 'Profit margin'],
  ];

  for (const [code, category, nameAr, nameEn] of elementSeeds) {
    await prisma.costElement.upsert({
      where: { code },
      update: {},
      create: { code, category, nameAr, nameEn },
    });
  }

  // A few standard rates, effective-dated from the start of the year. New
  // prices must be added as new rows — never by editing these.
  const resourceSeeds = [
    ['RES-SPLICE-TEAM', 'LABOR', 'فريق لحام', 'Splicing team', 'day', 4200],
    ['RES-CIVIL-CREW', 'LABOR', 'طاقم مدني', 'Civil crew', 'meter', 95],
    ['RES-EXCAVATOR', 'EQUIPMENT', 'حفار', 'Excavator', 'hour', 850],
    ['RES-PICKUP', 'VEHICLE', 'سيارة نقل', 'Pickup', 'month', 9000],
    ['RES-PM', 'LABOR', 'مدير مشروع', 'Project manager', 'month', 38000],
  ];

  for (const [code, type, nameAr, nameEn, unit, standardCost] of resourceSeeds) {
    const exists = await prisma.resource.findFirst({ where: { code } });
    if (!exists) {
      await prisma.resource.create({
        data: {
          code,
          type,
          nameAr,
          nameEn,
          unit,
          standardCost,
          currency: 'EGP',
          country: 'EG',
          source: 'INTERNAL_RATE',
          effectiveFrom: new Date('2026-01-01'),
        },
      });
    }
  }


  // ---------------------------------------------------------------------------
  // Release 6 — the approval workflow, as structure without numbers.
  //
  // The steps and rules are seeded; the thresholds they read are NOT. Afro
  // Group's answer to "what are the real approval limits" was that they differ
  // by project, opportunity and country and belong to the responsible manager,
  // so seeding a plausible 12% here would put a number nobody agreed to in
  // front of an approver and let it quietly become policy by default.
  //
  // With no limits configured every rule reports as undetermined, which makes
  // each deal require a human decision and the settings screen show exactly
  // what still has to be decided. That is the honest starting state.
  // ---------------------------------------------------------------------------
  const workflow = await prisma.workflowDefinition.upsert({
    where: { code: 'WF-PRICING-DEFAULT' },
    update: {},
    create: {
      code: 'WF-PRICING-DEFAULT',
      name: 'Opportunity pricing approval',
      businessProcess: 'OPPORTUNITY_PRICING',
    },
  });

  // The desks available, in order. isMandatory is false on all of them so the
  // RULES decide which are engaged: a margin exception that needs the CEO
  // should not also be parked on two desks no rule asked for. Afro can mark a
  // step mandatory later if some approver must always sign.
  const steps = [
    { sequence: 1, name: 'Sales Director', approverRole: 'SALES_DIRECTOR', slaHours: 24, isMandatory: false },
    { sequence: 2, name: 'Finance', approverRole: 'FINANCE', slaHours: 48, isMandatory: false },
    { sequence: 3, name: 'Chief Executive', approverRole: 'CEO', slaHours: 72, isMandatory: false },
  ];
  for (const step of steps) {
    const exists = await prisma.workflowStep.findFirst({
      where: { workflowId: workflow.id, sequence: step.sequence },
    });
    if (!exists) {
      await prisma.workflowStep.create({ data: { ...step, workflowId: workflow.id } });
    }
  }

  // The spec's own worked examples, section 28.
  const rules = [
    {
      conditionField: 'GROSS_MARGIN_PERCENT',
      operator: 'LESS_THAN',
      thresholdPolicyKey: 'MIN_GROSS_MARGIN_PERCENT',
      requiredRole: 'CEO',
      priority: 100,
      reason: 'Margin below the approved floor',
    },
    {
      conditionField: 'OPPORTUNITY_VALUE',
      operator: 'GREATER_THAN',
      thresholdPolicyKey: 'APPROVAL_VALUE_LIMIT',
      requiredRole: 'OWNER_BOARD',
      priority: 90,
      reason: 'Deal value above the delegated limit',
    },
    {
      conditionField: 'PAYMENT_TERM_DAYS',
      operator: 'GREATER_THAN',
      thresholdPolicyKey: 'MAX_PAYMENT_TERM_DAYS',
      requiredRole: 'FINANCE',
      priority: 80,
      reason: 'Collection period longer than company policy',
    },
    {
      conditionField: 'SINGLE_SOURCE_SUPPLIER',
      operator: 'IS_TRUE',
      requiredRole: 'PROCUREMENT',
      priority: 60,
      reason: 'Dependent on a single supplier',
    },
    {
      conditionField: 'SCOPE_NOT_READY',
      operator: 'IS_TRUE',
      requiredRole: 'OPERATIONS',
      priority: 70,
      reason: 'Scope still carries a blocking clarification',
    },
  ];
  for (const rule of rules) {
    const exists = await prisma.approvalRule.findFirst({
      where: { workflowId: workflow.id, conditionField: rule.conditionField },
    });
    if (!exists) {
      await prisma.approvalRule.create({ data: { ...rule, workflowId: workflow.id } });
    }
  }

  // One row per (event, role): the model targets a single role so governance
  // can add or drop one listener without touching the others.
  for (const [eventType, roles] of [
    ['APPROVAL_REQUESTED', ['SALES_DIRECTOR', 'FINANCE', 'CEO']],
    ['APPROVAL_DECIDED', ['SALES_DIRECTOR']],
    ['PROPOSAL_SUBMITTED', ['SALES_DIRECTOR', 'CEO']],
  ]) {
    for (const roleTarget of roles) {
      const exists = await prisma.notificationRule.findFirst({
        where: { eventType, roleTarget },
      });
      if (!exists) {
        await prisma.notificationRule.create({ data: { eventType, roleTarget } });
      }
    }
  }

  console.log('Seed complete.');
  console.log(`Users seeded with password: ${SEED_PASSWORD}`);
  console.log('Sign in as ceo@afro.example / am@afro.example / admin@afro.example');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
