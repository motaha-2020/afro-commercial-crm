/**
 * Demo pipeline, transcribed from the commercial team's own tracker:
 *   .../2026/tenders/Pip Line/Sales_Pipeline_2026.xlsx  →  sheet "Sales Pipline"
 *
 * This replaced the previous invented accounts (STE, Madagascar Fiber, East
 * Africa Mobile, Comoros Digital). Demo data that mirrors the real book is
 * worth more than plausible fiction: stage distribution, deal sizes and the
 * Won/Lost split are the ones the team will recognise, so anything the screens
 * get wrong about them is visible immediately rather than in production.
 *
 * Still SAMPLE data. It is deleted and rewritten on every seed run.
 *
 * The tracker's vocabulary is not the system's, so two mappings are applied
 * here, once, rather than being re-guessed at each call site:
 *
 *   Stage    tracker → OpportunityStage
 *   Priority tracker → forecastCategory (the system has no priority field;
 *                      forecast category is the nearest honest equivalent)
 *
 * A Closed row carries the outcome in Status, not Stage: "Won" closes the
 * opportunity at PROJECT_HANDOVER, "Lose" leaves it at the stage it died in
 * (PROPOSAL_SUBMISSION — all losses in this book were on price, after the
 * offer went in) with status LOST and an exit reason.
 *
 * Amounts are EGP, as recorded. The tracker leaves the amount blank where no
 * number has been agreed; that stays null rather than becoming a zero, which
 * would read as a free project in every roll-up.
 */

/** Tracker stage → schema stage, for rows that are not Closed. */
const STAGE_MAP = {
  'Lead': 'LEAD_QUALIFICATION',
  'Discovery': 'SCOPE_DISCOVERY',
  'Survey': 'SCOPE_DISCOVERY',
  'Tender': 'BID_STRATEGY_SOLUTION',
  'Commercial': 'PROPOSAL_SUBMISSION',
  'Closing': 'CLARIFICATIONS_NEGOTIATION',
  'Pre-Execution': 'AWARD_CONTRACTING',
};

/** Tracker priority → forecast category. "—" is used on closed rows. */
const FORECAST_MAP = {
  '🔥 Very High': 'COMMIT',
  'High': 'BEST_CASE',
  'Medium': 'UPSIDE',
  'Low': 'PIPELINE',
  '—': 'PIPELINE',
};

export const accounts = [
  { key: 'VODAFONE', code: 'ACC-2026-000001', legalName: 'Vodafone Egypt', type: 'OPERATOR', country: 'EG', industry: 'TELECOM', paymentTermDays: 90 },
  { key: 'ORANGE', code: 'ACC-2026-000002', legalName: 'Orange Egypt', type: 'OPERATOR', country: 'EG', industry: 'TELECOM', paymentTermDays: 90 },
  { key: 'ACT', code: 'ACC-2026-000003', legalName: 'ACT', type: 'ENTERPRISE', country: 'EG', industry: 'HOSPITALITY', paymentTermDays: 60 },
];

/**
 * One entry per tracker row, in tracker order. `stage`/`status`/`priority` are
 * the tracker's own words; `toOpportunity` below turns them into schema values.
 */
export const rows = [
  { account: 'VODAFONE', name: 'FTTH Maintenance', department: 'Gated Community', stage: 'Tender', status: 'Waiting for auction (End of April)', priority: 'Medium', nextAction: 'Follow up before tender', amount: null },
  { account: 'VODAFONE', name: 'FTTH Design', department: 'Gated Community', stage: 'Tender', status: 'Waiting for auction (End of April)', priority: 'Medium', nextAction: 'Prepare strong technical offer', amount: null },
  { account: 'VODAFONE', name: 'Small Data Center / IT Room', department: 'Business', stage: 'Closed', status: 'Lose', priority: '—', nextAction: 'Price', amount: 1600000 },
  { account: 'VODAFONE', name: 'FTTS', department: 'Transmission', stage: 'Discovery', status: 'First meeting completed', priority: 'Medium', nextAction: 'Arrange technical workshop', amount: null },
  { account: 'VODAFONE', name: 'Core Switching', department: 'Core', stage: 'Pre-Execution', status: 'Waiting for P.O.', priority: '🔥 Very High', nextAction: 'Daily follow-up until P.O.', amount: null },
  { account: 'VODAFONE', name: 'Drive Test', department: 'Radio', stage: 'Commercial', status: 'Offer submitted', priority: 'Medium', nextAction: 'Waiting Procurement feedback', amount: null },
  { account: 'VODAFONE', name: 'FTTH Compounds', department: 'Gated Community', stage: 'Closed', status: 'Won', priority: '—', nextAction: 'Start execution', amount: 5000000 },

  { account: 'ORANGE', name: 'FTTH Maintenance (New Capital)', department: 'B2B', stage: 'Closing', status: 'Waiting for contract renewal P.O.', priority: '🔥 Very High', nextAction: 'Escalate and follow up', amount: 46865189.91, note: '3 Years' },
  { account: 'ORANGE', name: 'TV Data Center', department: 'B2B', stage: 'Closed', status: 'Won', priority: '—', nextAction: 'Start execution', amount: 65000000 },
  { account: 'ORANGE', name: 'MCIT CAPMAS Data Center', department: 'B2B', stage: 'Closed', status: 'Lose', priority: '—', nextAction: 'Price', amount: 30000000 },
  { account: 'ORANGE', name: 'Drive Test', department: 'Radio', stage: 'Commercial', status: 'Offer submitted', priority: 'Medium', nextAction: 'Follow up', amount: 13779640.8 },
  { account: 'ORANGE', name: 'FTTH Compound 1', department: 'Triple Play', stage: 'Closed', status: 'Won', priority: '—', nextAction: 'Start execution', amount: 1000000 },
  { account: 'ORANGE', name: 'FTTH Compound 2 (DISTRICT 5)', department: 'Triple Play', stage: 'Closed', status: 'Won', priority: '—', nextAction: 'P.O. received', amount: 11000000 },
  { account: 'ORANGE', name: 'FTTH Compound 3 (Stoda)', department: 'Triple Play', stage: 'Commercial', status: 'Offer submitted', priority: 'High', nextAction: 'Waiting Procurement feedback', amount: 7300000 },
  { account: 'ORANGE', name: 'OLAN – Pyramids Area', department: 'B2B', stage: 'Survey', status: 'Waiting for site survey', priority: 'High', nextAction: 'Arrange survey ASAP', amount: 30000000 },
  { account: 'ORANGE', name: 'Data Network Cables 2026 RFQ', department: 'B2B', stage: 'Closed', status: 'Lose', priority: '—', nextAction: 'Price', amount: 8000000 },
  { account: 'ORANGE', name: 'Small Data Center 1', department: 'B2B', stage: 'Closed', status: 'Lose', priority: '—', nextAction: 'Price', amount: 1700000 },
  { account: 'ORANGE', name: 'Small Data Center 2', department: 'B2B', stage: 'Closed', status: 'Lose', priority: '—', nextAction: 'Price', amount: 2100000 },
  { account: 'ORANGE', name: 'Small Data Center 3', department: 'B2B', stage: 'Closed', status: 'Lose', priority: '—', nextAction: 'Price', amount: 2100000 },
  { account: 'ORANGE', name: 'Physical Count – Greater Cairo RFQ', department: 'Transmission', stage: 'Commercial', status: 'Tendering stage', priority: 'High', nextAction: 'Schedule follow-up meeting', amount: 1200000 },
  { account: 'ORANGE', name: 'Coca-Cola Factories & Branches Network', department: 'Enterprise', stage: 'Lead', status: 'Offer submitted', priority: 'Medium', nextAction: 'Identify decision makers + intro meeting', amount: 4000000 },
  { account: 'ORANGE', name: 'B2B Expansion (Multiple Sites)', department: 'B2B', stage: 'Lead', status: 'Potential pipeline', priority: 'Medium', nextAction: 'Map opportunities + contacts', amount: 2000000 },

  { account: 'ACT', name: 'Data Center / ELV Projects', department: 'Hospitality', stage: 'Closed', status: 'Lose', priority: '—', nextAction: 'Price', amount: 1800000 },
];

/**
 * Turns one tracker row into Opportunity create-data, given the ids it has to
 * point at. Kept beside the rows so the mapping rules and the data they apply
 * to cannot drift apart.
 */
export function toOpportunity(row, index, { accountId, ownerId, orgUnitId }) {
  const won = row.stage === 'Closed' && row.status === 'Won';
  const lost = row.stage === 'Closed' && row.status === 'Lose';

  const stage = won
    ? 'PROJECT_HANDOVER'
    : lost
      ? 'PROPOSAL_SUBMISSION'
      : STAGE_MAP[row.stage] ?? 'LEAD_QUALIFICATION';

  const status = won ? 'CLOSED' : lost ? 'LOST' : 'ACTIVE';

  const forecastCategory = won
    ? 'CLOSED_WON'
    : FORECAST_MAP[row.priority] ?? 'PIPELINE';

  // Health reports whether the deal needs attention, so a loss is red and a
  // delivered win is green; everything else takes its cue from priority.
  const health = lost ? 'RED' : won ? 'GREEN' : row.priority === '🔥 Very High' ? 'AMBER' : 'GREEN';

  // The tracker's Status and Priority have no columns of their own here, and
  // they are the two things a reviewer asks about first — so they are carried
  // in the description rather than dropped.
  const description = [
    `Tracker status: ${row.status}`,
    `Tracker priority: ${row.priority}`,
    `Department: ${row.department}`,
    row.note ? `Note: ${row.note}` : null,
  ].filter(Boolean).join(' | ');

  return {
    code: `OPP-2026-${String(index + 1).padStart(6, '0')}`,
    name: row.name,
    description,
    accountId,
    ownerId,
    orgUnitId,
    country: 'EG',
    industry: row.department,
    currency: 'EGP',
    estimatedValue: row.amount,
    stage,
    status,
    forecastCategory,
    health,
    exitReason: lost ? 'LOST' : null,
    exitNotes: lost ? 'Lost on price.' : null,
    nextStep: row.nextAction,
    source: 'Sales_Pipeline_2026.xlsx',
  };
}
