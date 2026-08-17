/**
 * Release 7 — Award, Contracts and Handover.
 *
 * Two sentences in the spec carry this whole release.
 *
 * Stage 10: "لا يجب اعتبار Verbal Award مساويًا لعقد موقع" — a verbal award is
 * not a signed contract. So winning is not a boolean. It is a ladder, and the
 * system has to know which rung you are on, because the things you may safely
 * do differ at each: you can plan a mobilisation on a letter of intent; you
 * should not commit money to a subcontractor on a phone call.
 *
 * Stage 11: "لا تبدأ مسؤولية مدير المشروع بمجرد تغيير حالة الفرصة" — a project
 * manager's responsibility does not begin because someone changed a status. It
 * begins when they say they received the scope, the baseline and the risks.
 *
 * The spec is unusually direct about the failure both rules prevent: "أن يفوز
 * فريق المبيعات بالمشروع ثم يكتشف مدير المشروع أن السعر أو الجدول غير قابل
 * للتنفيذ" — sales wins the job, and the project manager then discovers the
 * price or the schedule cannot be delivered.
 */

// ---------------------------------------------------------------------------
// How firm is this win?
// ---------------------------------------------------------------------------

export const AWARD_TYPES = [
  'VERBAL_AWARD',
  'LETTER_OF_INTENT',
  'PURCHASE_ORDER',
  'CONTRACT_RECEIVED',
  'CONTRACT_SIGNED',
  'NOTICE_TO_PROCEED',
] as const;
export type AwardType = (typeof AWARD_TYPES)[number];

/**
 * Strength, 1..6. Ordered deliberately: a purchase order outranks a letter of
 * intent because it is an order, and a received-but-unsigned contract outranks
 * both because its terms are fixed even if the signature is pending.
 */
export const AWARD_STRENGTH: Record<AwardType, number> = {
  VERBAL_AWARD: 1,
  LETTER_OF_INTENT: 2,
  PURCHASE_ORDER: 3,
  CONTRACT_RECEIVED: 4,
  CONTRACT_SIGNED: 5,
  NOTICE_TO_PROCEED: 6,
};

/**
 * The line the spec draws. Below it a win is a expectation; at or above it the
 * customer has committed something in writing that can be held to.
 */
export const CONTRACTUALLY_BINDING_FROM: AwardType = 'PURCHASE_ORDER';

export function isBinding(type: AwardType): boolean {
  return AWARD_STRENGTH[type] >= AWARD_STRENGTH[CONTRACTUALLY_BINDING_FROM];
}

export function strongerAward(a: AwardType, b: AwardType): AwardType {
  return AWARD_STRENGTH[a] >= AWARD_STRENGTH[b] ? a : b;
}

/**
 * Commitments that must not rest on a verbal award.
 *
 * Kept as data rather than scattered `if` statements so the list can be read
 * and argued with by someone who is not going to read the service layer — and
 * so adding a seventh commitment is a decision, not an omission.
 */
export const REQUIRES_BINDING_AWARD = [
  'HANDOVER_TO_PROJECT',
  'AWARD_SUBCONTRACT',
  'ISSUE_PURCHASE_ORDER',
] as const;
export type BindingGatedAction = (typeof REQUIRES_BINDING_AWARD)[number];

// ---------------------------------------------------------------------------
// What the contract changed
// ---------------------------------------------------------------------------

export const DEVIATION_FIELDS = [
  'PRICE',
  'QUANTITIES',
  'PAYMENT_TERMS',
  'DURATION',
  'WARRANTY',
  'PENALTIES',
  'LIABILITIES',
  'TAXES',
  'EXCLUSIONS',
  'NEW_CLAUSE',
] as const;
export type DeviationField = (typeof DEVIATION_FIELDS)[number];

export const RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

/**
 * The clause headings a contract review actually walks through.
 *
 * A managed list rather than free text, because the whole point of registering
 * clauses is to be able to ask "what did we agree about liability across our
 * live contracts?" — and that question cannot be answered over a column where
 * one reviewer typed "Liability" and the next typed "Limitation of liability".
 */
export const CONTRACT_CLAUSE_TYPES = [
  'SCOPE',
  'PRICE',
  'PAYMENT_TERMS',
  'DURATION',
  'DELIVERY',
  'WARRANTY',
  'PENALTIES',
  'LIABILITY_CAP',
  'INDEMNITY',
  'INSURANCE',
  'TAXES',
  'VARIATIONS',
  'TERMINATION',
  'FORCE_MAJEURE',
  'CONFIDENTIALITY',
  'IP_RIGHTS',
  'DISPUTE_RESOLUTION',
  'GOVERNING_LAW',
  'EXCLUSIONS',
  'OTHER',
] as const;
export type ContractClauseType = (typeof CONTRACT_CLAUSE_TYPES)[number];

/**
 * Above medium risk, "approved" must be accompanied by what we intend to do
 * about it.
 *
 * Signing off an uncapped liability with an empty mitigation field records a
 * decision nobody can later explain, and the explanation is the only thing
 * anyone will want when the clause is invoked. Below that line the note is
 * optional: demanding one for every routine governing-law clause is how a
 * required field becomes a field people paste "N/A" into.
 */
export function clauseNeedsMitigation(risk: RiskLevel): boolean {
  return risk === 'HIGH' || risk === 'CRITICAL';
}

/** The proposal side and the contract side of the same terms. */
export interface ComparableTerms {
  price?: number | null;
  paymentTerms?: string | null;
  durationDays?: number | null;
  warrantyMonths?: number | null;
  ldPercent?: number | null;
  liabilityCap?: number | null;
}

export interface DetectedDeviation {
  field: DeviationField;
  proposalValue: string | null;
  contractValue: string | null;
  riskLevel: RiskLevel;
  /** Negative means the contract is worse for us than the proposal was. */
  direction: 'WORSE' | 'BETTER' | 'CHANGED';
}

/** A money difference this small is rounding, not a negotiated change. */
const MONEY_EPSILON = 0.01;

function severityForPrice(proposal: number, contract: number): RiskLevel {
  const drop = ((proposal - contract) / proposal) * 100;
  if (drop <= 0) return 'LOW';
  if (drop < 2) return 'MEDIUM';
  if (drop < 5) return 'HIGH';
  return 'CRITICAL';
}

/**
 * Compares what was offered with what the contract says.
 *
 * Every difference is reported, including ones in our favour. A contract that
 * quietly pays MORE than the proposal is still a discrepancy someone should
 * look at — it usually means the wrong document was signed, and finding out
 * from the customer later is worse than finding out now.
 *
 * Nothing here decides what to do about a deviation. It reports; a person
 * accepts, rejects or mitigates, and SOD_06 keeps that person separate from
 * whoever prepared it.
 */
export function detectDeviations(
  proposal: ComparableTerms,
  contract: ComparableTerms,
): DetectedDeviation[] {
  const found: DetectedDeviation[] = [];

  const num = (v: number | null | undefined) => (v === null || v === undefined ? null : v);
  const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

  const p = num(proposal.price);
  const c = num(contract.price);
  if (p !== null && c !== null && Math.abs(p - c) > MONEY_EPSILON) {
    found.push({
      field: 'PRICE',
      proposalValue: str(p),
      contractValue: str(c),
      riskLevel: severityForPrice(p, c),
      direction: c < p ? 'WORSE' : 'BETTER',
    });
  }

  if (
    (proposal.paymentTerms ?? null) !== (contract.paymentTerms ?? null) &&
    (proposal.paymentTerms || contract.paymentTerms)
  ) {
    found.push({
      field: 'PAYMENT_TERMS',
      proposalValue: str(proposal.paymentTerms),
      contractValue: str(contract.paymentTerms),
      riskLevel: 'HIGH',
      direction: 'CHANGED',
    });
  }

  const pd = num(proposal.durationDays);
  const cd = num(contract.durationDays);
  if (pd !== null && cd !== null && pd !== cd) {
    found.push({
      field: 'DURATION',
      proposalValue: str(pd),
      contractValue: str(cd),
      // A shorter contract duration than we priced is the dangerous direction:
      // the same work in less time is a cost increase nobody has costed.
      riskLevel: cd < pd ? 'HIGH' : 'MEDIUM',
      direction: cd < pd ? 'WORSE' : 'BETTER',
    });
  }

  const pw = num(proposal.warrantyMonths);
  const cw = num(contract.warrantyMonths);
  if (pw !== null && cw !== null && pw !== cw) {
    found.push({
      field: 'WARRANTY',
      proposalValue: str(pw),
      contractValue: str(cw),
      riskLevel: cw > pw ? 'HIGH' : 'LOW',
      direction: cw > pw ? 'WORSE' : 'BETTER',
    });
  }

  const pl = num(proposal.ldPercent);
  const cl = num(contract.ldPercent);
  if (pl !== cl && (pl !== null || cl !== null)) {
    found.push({
      field: 'PENALTIES',
      proposalValue: str(pl),
      contractValue: str(cl),
      // Liquidated damages appearing where none were offered is the classic
      // contract surprise, so an introduced penalty is always critical.
      riskLevel: pl === null ? 'CRITICAL' : (cl ?? 0) > (pl ?? 0) ? 'HIGH' : 'LOW',
      direction: (cl ?? 0) > (pl ?? 0) ? 'WORSE' : 'BETTER',
    });
  }

  const pc = num(proposal.liabilityCap);
  const cc = num(contract.liabilityCap);
  if (pc !== cc && (pc !== null || cc !== null)) {
    found.push({
      field: 'LIABILITIES',
      proposalValue: str(pc),
      contractValue: str(cc),
      // No cap at all is unlimited liability — the worst case, not a missing
      // value.
      riskLevel: cc === null ? 'CRITICAL' : (cc ?? 0) > (pc ?? 0) ? 'MEDIUM' : 'HIGH',
      direction: cc === null || (cc ?? 0) < (pc ?? 0) ? 'WORSE' : 'BETTER',
    });
  }

  const order: Record<RiskLevel, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  return found.sort((a, b) => order[a.riskLevel] - order[b.riskLevel]);
}

export function hasBlockingDeviation(deviations: readonly DetectedDeviation[]): boolean {
  return deviations.some((d) => d.riskLevel === 'CRITICAL');
}

// ---------------------------------------------------------------------------
// The exit gate
// ---------------------------------------------------------------------------

/**
 * The spec's conditions for turning an opportunity into a project, verbatim
 * from stage 10: an approved award document, a contract review, a fixed value,
 * a fixed scope, an approved cost baseline, a named project manager and a
 * start date.
 */
export const HANDOVER_REQUIREMENTS = [
  'BINDING_AWARD',
  'CONTRACT_REVIEWED',
  'VALUE_FIXED',
  'SCOPE_FIXED',
  'COST_BASELINE_APPROVED',
  'PROJECT_MANAGER_NAMED',
  'START_DATE_SET',
  'DEVIATIONS_RESOLVED',
] as const;
export type HandoverRequirement = (typeof HANDOVER_REQUIREMENTS)[number];

export interface HandoverReadinessInput {
  awardType?: AwardType | null;
  contractReviewedAt?: Date | null;
  contractValue?: number | null;
  scopeReady?: boolean;
  costBaselineApproved?: boolean;
  projectManagerId?: string | null;
  plannedStartDate?: Date | null;
  openCriticalDeviations?: number;
}

export interface HandoverReadiness {
  ready: boolean;
  met: HandoverRequirement[];
  missing: HandoverRequirement[];
}

/**
 * Whether an opportunity may become a project, and if not, exactly what is
 * missing — by name.
 *
 * Named rather than counted, for the same reason progressive data capture
 * names its missing fields: "5 of 8 complete" tells someone they are nearly
 * there without telling them the three that matter are the cost baseline, the
 * project manager and an unresolved critical deviation.
 */
export function handoverReadiness(input: HandoverReadinessInput): HandoverReadiness {
  const met: HandoverRequirement[] = [];
  const missing: HandoverRequirement[] = [];

  const check = (requirement: HandoverRequirement, satisfied: boolean) =>
    (satisfied ? met : missing).push(requirement);

  // A verbal award is not enough to hand a project to operations. This is the
  // rule the release exists for.
  check('BINDING_AWARD', input.awardType ? isBinding(input.awardType) : false);
  check('CONTRACT_REVIEWED', Boolean(input.contractReviewedAt));
  check('VALUE_FIXED', input.contractValue !== null && input.contractValue !== undefined);
  check('SCOPE_FIXED', input.scopeReady === true);
  check('COST_BASELINE_APPROVED', input.costBaselineApproved === true);
  check('PROJECT_MANAGER_NAMED', Boolean(input.projectManagerId));
  check('START_DATE_SET', Boolean(input.plannedStartDate));
  check('DEVIATIONS_RESOLVED', (input.openCriticalDeviations ?? 0) === 0);

  return { ready: missing.length === 0, met, missing };
}

// ---------------------------------------------------------------------------
// Who has to accept the handover
// ---------------------------------------------------------------------------

export const HANDOVER_PARTIES = [
  'SALES',
  'COMMERCIAL',
  'FINANCE',
  'OPERATIONS',
  'PROCUREMENT',
  'PROJECT_MANAGER',
  'LEGAL',
] as const;
export type HandoverParty = (typeof HANDOVER_PARTIES)[number];

/**
 * Legal signs only when the contract needs it ("Legal عند الحاجة"), so it is
 * the one party not required by default. Every other seat named in the spec is.
 */
export const REQUIRED_HANDOVER_PARTIES: readonly HandoverParty[] = [
  'SALES',
  'COMMERCIAL',
  'FINANCE',
  'OPERATIONS',
  'PROCUREMENT',
  'PROJECT_MANAGER',
] as const;

export const HANDOVER_CATEGORIES = [
  'CONTRACT',
  'BOQ',
  'COST_BASELINE',
  'SCOPE',
  'ASSUMPTIONS',
  'EXCLUSIONS',
  'RISKS',
  'PAYMENT',
  'SUPPLIERS',
  'SUBCONTRACTORS',
  'SCHEDULE',
  'CUSTOMER_CONTACTS',
  'DRAWINGS',
  'PERMITS',
] as const;
export type HandoverCategory = (typeof HANDOVER_CATEGORIES)[number];

export interface SignoffState {
  party: HandoverParty;
  isAccepted?: boolean | null;
}

export interface SignoffProgress {
  accepted: HandoverParty[];
  rejected: HandoverParty[];
  awaiting: HandoverParty[];
  complete: boolean;
}

/**
 * Where the handover stands.
 *
 * A rejection does not merely fail to complete it — it stops it, because a
 * project manager saying "I cannot deliver this" is the single most valuable
 * signal in the whole release and must not be averaged away by five other
 * people having said yes.
 */
export function signoffProgress(signoffs: readonly SignoffState[]): SignoffProgress {
  const byParty = new Map(signoffs.map((s) => [s.party, s.isAccepted]));

  const accepted: HandoverParty[] = [];
  const rejected: HandoverParty[] = [];
  const awaiting: HandoverParty[] = [];

  for (const party of REQUIRED_HANDOVER_PARTIES) {
    const state = byParty.get(party);
    if (state === true) accepted.push(party);
    else if (state === false) rejected.push(party);
    else awaiting.push(party);
  }

  return {
    accepted,
    rejected,
    awaiting,
    complete: rejected.length === 0 && awaiting.length === 0,
  };
}
