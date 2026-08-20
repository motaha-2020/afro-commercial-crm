/**
 * The only fields a model may ever see, per resource.
 *
 * An allow-list, not a deny-list: a field added to the schema later stays
 * invisible to the agents until someone decides it belongs here. Raw `id` is
 * absent everywhere by design — the model addresses records by `code`, and the
 * output guard rejects any UUID that reaches an answer.
 */

const money = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);

const day = (value: Date | null | undefined): string | null =>
  value ? value.toISOString().slice(0, 10) : null;

export interface OpportunityView {
  code: string;
  name: string;
  account: string | null;
  owner: string | null;
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
  expectedCloseDate: string | null;
  submissionDate: string | null;
  nextStep: string | null;
}

/** Accepts the shape `OpportunitiesService.list` returns (account + owner included). */
export function opportunityView(row: any): OpportunityView {
  return {
    code: row.code,
    name: row.name,
    account: row.account?.legalName ?? null,
    owner: row.owner?.fullNameAr ?? row.owner?.fullNameEn ?? null,
    stage: row.stage,
    status: row.status,
    forecastCategory: row.forecastCategory,
    health: row.health,
    country: row.country,
    currency: row.currency,
    estimatedValue: money(row.estimatedValue),
    proposedPrice: money(row.proposedPrice),
    marginPercent: money(row.marginPercent),
    probability: row.probability ?? null,
    expectedCloseDate: day(row.expectedCloseDate),
    submissionDate: day(row.submissionDate),
    nextStep: row.nextStep ?? null,
  };
}

export interface AccountView {
  code: string;
  legalName: string;
  tradeName: string | null;
  type: string;
  industry: string | null;
  country: string;
  city: string | null;
  creditStatus: string;
  paymentTermDays: number | null;
  owner: string | null;
}

export function accountView(row: any): AccountView {
  return {
    code: row.code,
    legalName: row.legalName,
    tradeName: row.tradeName ?? null,
    type: row.type,
    industry: row.industry ?? null,
    country: row.country,
    city: row.city ?? null,
    creditStatus: row.creditStatus,
    paymentTermDays: row.paymentTermDays ?? null,
    owner: row.owner?.fullNameAr ?? row.owner?.fullNameEn ?? null,
  };
}

export interface ActivityView {
  type: string;
  subject: string;
  opportunity: string | null;
  account: string | null;
  user: string | null;
  dueAt: string | null;
  completedAt: string | null;
}

export function activityView(row: any): ActivityView {
  return {
    type: row.type,
    subject: row.subject,
    opportunity: row.opportunity?.code ?? null,
    account: row.account?.code ?? null,
    user: row.user?.fullNameAr ?? row.user?.fullNameEn ?? null,
    dueAt: day(row.dueAt),
    completedAt: day(row.completedAt),
  };
}
