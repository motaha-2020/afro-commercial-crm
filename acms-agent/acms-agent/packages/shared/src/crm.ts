/**
 * Lead, contact and activity vocabulary — the day-to-day CRM layer that sits
 * before an opportunity exists.
 *
 * A lead is not an early opportunity. The spec keeps them apart because a lead
 * may never become one, and forcing every enquiry into the opportunity pipeline
 * is what makes forecast numbers meaningless. Conversion is therefore an event
 * that is recorded, not a status the same row drifts into.
 */

export const LEAD_STATUSES = [
  'NEW',
  'WORKING',
  'QUALIFIED',
  'CONVERTED',
  'DISQUALIFIED',
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

/**
 * Permitted status moves. Two rules the spec is explicit about:
 * a lead may be disqualified from any live status (an enquiry can die at any
 * moment), and CONVERTED / DISQUALIFIED are terminal — a converted lead that
 * could be reopened would let one enquiry feed two opportunities.
 */
export const LEAD_STATUS_TRANSITIONS: Record<LeadStatus, readonly LeadStatus[]> = {
  NEW: ['WORKING', 'QUALIFIED', 'DISQUALIFIED'],
  WORKING: ['QUALIFIED', 'DISQUALIFIED'],
  QUALIFIED: ['CONVERTED', 'DISQUALIFIED'],
  CONVERTED: [],
  DISQUALIFIED: [],
};

export const TERMINAL_LEAD_STATUSES: readonly LeadStatus[] = ['CONVERTED', 'DISQUALIFIED'];

export function isLeadTerminal(status: LeadStatus): boolean {
  return TERMINAL_LEAD_STATUSES.includes(status);
}

export function canTransitionLead(from: LeadStatus, to: LeadStatus): boolean {
  return LEAD_STATUS_TRANSITIONS[from].includes(to);
}

/**
 * Only a qualified lead converts. Converting straight from NEW would put an
 * unexamined enquiry into the pipeline carrying a forecast value.
 */
export const LEAD_CONVERTIBLE_FROM: LeadStatus = 'QUALIFIED';

export const ACTIVITY_TYPES = [
  'CALL',
  'MEETING',
  'EMAIL',
  'SITE_VISIT',
  'NOTE',
  'TASK',
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

/**
 * Types that describe something already done. A logged call has happened; a
 * task has not. Completing the former on creation saves a pointless second
 * click, and leaving the latter open is what makes a follow-up list possible.
 */
export const RETROSPECTIVE_ACTIVITY_TYPES: readonly ActivityType[] = [
  'CALL',
  'MEETING',
  'EMAIL',
  'SITE_VISIT',
  'NOTE',
];

export function isRetrospectiveActivity(type: ActivityType): boolean {
  return RETROSPECTIVE_ACTIVITY_TYPES.includes(type);
}

/**
 * Contact roles are rows, not a column: one person is routinely both the
 * technical approver and the commercial signatory, and a single-value field
 * would force a choice that loses information the bid team needs.
 */
export const CONTACT_ROLES = [
  'DECISION_MAKER',
  'TECHNICAL_EVALUATOR',
  'COMMERCIAL_EVALUATOR',
  'PROCUREMENT',
  'FINANCE',
  'END_USER',
  'GATEKEEPER',
  'CHAMPION',
  'BLOCKER',
] as const;
export type ContactRole = (typeof CONTACT_ROLES)[number];

/** Decision-making weight, used when mapping the buying centre. */
export const CONTACT_INFLUENCE_LEVELS = ['HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'] as const;
export type ContactInfluence = (typeof CONTACT_INFLUENCE_LEVELS)[number];

/** Directed account-to-account links. */
export const ACCOUNT_RELATIONSHIP_TYPES = [
  'PARENT',
  'SUBSIDIARY',
  'JV_PARTNER',
  'CONSORTIUM_MEMBER',
  'COMPETITOR',
  'MAIN_CONTRACTOR',
  'SUBCONTRACTOR',
] as const;
export type AccountRelationshipType = (typeof ACCOUNT_RELATIONSHIP_TYPES)[number];
