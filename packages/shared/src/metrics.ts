/**
 * Release 12 — the reporting model.
 *
 * The spec's section 36 asks for a Semantic Metrics layer and gives the reason
 * in one sentence: "يجب أن يكون التعريف موحدًا، حتى لا يحسب كل مدير المؤشر
 * بطريقة مختلفة" — the definition must be single, so that each manager does not
 * compute the indicator a different way.
 *
 * That is the whole point of this file. A win rate computed in the dashboard
 * component, again in a report, and again in a board pack will disagree by the
 * third quarter, and the argument that follows is about arithmetic rather than
 * about the business. So every metric is defined once, here, as a pure
 * function over facts the caller supplies.
 *
 * Section 30 adds a gate before any new indicator is admitted, and the
 * questions are good enough to be worth encoding rather than remembering:
 * what decision does it serve, who owns it, is the data reliable, and can a
 * user manipulate it? Each definition below answers them, and `gameable` is
 * the one people skip — a metric someone can move without doing the work will
 * be moved without doing the work.
 */

// ---------------------------------------------------------------------------
// The catalogue
// ---------------------------------------------------------------------------

export const METRIC_CODES = [
  'PIPELINE_VALUE',
  'WEIGHTED_PIPELINE',
  'WIN_RATE',
  'AVERAGE_DEAL_SIZE',
  'GROSS_MARGIN',
  'STAGE_AGEING',
  'PROPOSAL_TURNAROUND',
  'FORECAST_ACCURACY',
  'CUSTOMER_CONCENTRATION',
  'SUPPLIER_DEPENDENCY',
  'OPEN_APPROVALS',
  'APPROVAL_WAIT',
  'AT_RISK_VALUE',
  'DORMANT_OPPORTUNITIES',
] as const;
export type MetricCode = (typeof METRIC_CODES)[number];

export interface MetricDefinition {
  code: MetricCode;
  /** The spec's formula, in words, so a reader can check the number. */
  formula: string;
  /** Section 30: what decision does this serve? */
  decision: string;
  /** Section 30: who owns the definition? */
  owner: string;
  unit: 'CURRENCY' | 'PERCENT' | 'COUNT' | 'DAYS';
  /**
   * Section 30: can a user move it without doing the work? Recorded because a
   * gameable metric put on a target becomes a target for gaming.
   */
  gameable: boolean;
  gamingNote?: string;
}

export const METRIC_DEFINITIONS: Record<MetricCode, MetricDefinition> = {
  PIPELINE_VALUE: {
    code: 'PIPELINE_VALUE',
    formula: 'Sum of estimated value across open opportunities',
    decision: 'Is there enough work in front of us to hit the year?',
    owner: 'SALES_DIRECTOR',
    unit: 'CURRENCY',
    gameable: true,
    gamingNote: 'Anyone may raise an estimated value; it costs nothing to type a larger number.',
  },
  WEIGHTED_PIPELINE: {
    code: 'WEIGHTED_PIPELINE',
    formula: 'Sum of estimated value × stage probability across open opportunities',
    decision: 'What can we actually plan cash and resources around?',
    owner: 'SALES_DIRECTOR',
    unit: 'CURRENCY',
    gameable: true,
    gamingNote: 'Advancing a stage raises the weight, so stage discipline is what keeps it honest.',
  },
  WIN_RATE: {
    code: 'WIN_RATE',
    // The spec's own worked example, kept verbatim.
    formula: 'Won ÷ (Won + Lost). Open opportunities are excluded from both sides.',
    decision: 'Are we bidding for the right work?',
    owner: 'SALES_DIRECTOR',
    unit: 'PERCENT',
    gameable: true,
    gamingNote: 'Leaving losses open rather than marking them lost inflates it silently.',
  },
  AVERAGE_DEAL_SIZE: {
    code: 'AVERAGE_DEAL_SIZE',
    formula: 'Total value of won opportunities ÷ number of won opportunities',
    decision: 'Are we winning the size of work we are built for?',
    owner: 'SALES_DIRECTOR',
    unit: 'CURRENCY',
    gameable: false,
  },
  GROSS_MARGIN: {
    code: 'GROSS_MARGIN',
    formula: '(Price − Cost) ÷ Price, over approved costings. Never over cost.',
    decision: 'Are we pricing well enough to survive delivery?',
    owner: 'FINANCE',
    unit: 'PERCENT',
    gameable: false,
  },
  STAGE_AGEING: {
    code: 'STAGE_AGEING',
    formula: 'Mean days open opportunities have spent in their current stage',
    decision: 'Where is the pipeline stuck?',
    owner: 'SALES_DIRECTOR',
    unit: 'DAYS',
    gameable: true,
    gamingNote: 'A stage can be nudged forward to reset the clock without the deal moving.',
  },
  PROPOSAL_TURNAROUND: {
    code: 'PROPOSAL_TURNAROUND',
    formula: 'Mean days from opportunity creation to first proposal submission',
    decision: 'Are we slow enough to be losing work to speed?',
    owner: 'SALES_DIRECTOR',
    unit: 'DAYS',
    gameable: false,
  },
  FORECAST_ACCURACY: {
    code: 'FORECAST_ACCURACY',
    formula: 'Won value ÷ value forecast as committed, over closed opportunities',
    decision: 'Can the board trust the forecast it is given?',
    owner: 'CEO',
    unit: 'PERCENT',
    gameable: true,
    gamingNote: 'Forecasting nothing makes accuracy meaningless rather than good.',
  },
  CUSTOMER_CONCENTRATION: {
    code: 'CUSTOMER_CONCENTRATION',
    formula: 'Share of won value held by the single largest customer',
    decision: 'How much does losing one relationship cost us?',
    owner: 'OWNER_BOARD',
    unit: 'PERCENT',
    gameable: false,
  },
  SUPPLIER_DEPENDENCY: {
    code: 'SUPPLIER_DEPENDENCY',
    formula: 'Share of selected quotation value held by the single largest partner',
    decision: 'Which supplier could stop us if they failed?',
    owner: 'PROCUREMENT',
    unit: 'PERCENT',
    gameable: false,
  },
  OPEN_APPROVALS: {
    code: 'OPEN_APPROVALS',
    formula: 'Count of approval requests still pending a decision',
    decision: 'What is waiting on management rather than on the market?',
    owner: 'CEO',
    unit: 'COUNT',
    gameable: false,
  },
  APPROVAL_WAIT: {
    code: 'APPROVAL_WAIT',
    formula: 'Mean hours pending approval requests have been waiting',
    decision: 'Are approvals the bottleneck?',
    owner: 'CEO',
    unit: 'DAYS',
    gameable: false,
  },
  AT_RISK_VALUE: {
    code: 'AT_RISK_VALUE',
    formula: 'Estimated value of open opportunities whose health is red',
    decision: 'What is in trouble while there is still time to act?',
    owner: 'SALES_DIRECTOR',
    unit: 'CURRENCY',
    gameable: true,
    gamingNote: 'Health is set by a person, so a red deal can simply be recoloured.',
  },
  DORMANT_OPPORTUNITIES: {
    code: 'DORMANT_OPPORTUNITIES',
    formula: 'Open opportunities with no activity logged for 30 days or more',
    decision: 'What has quietly been abandoned without being closed?',
    owner: 'SALES_DIRECTOR',
    unit: 'COUNT',
    gameable: true,
    gamingNote: 'Logging a token activity resets it without the deal progressing.',
  },
};

/** Days without an activity before an open opportunity counts as dormant. */
export const DORMANT_AFTER_DAYS = 30;

// ---------------------------------------------------------------------------
// The facts a metric is computed from
// ---------------------------------------------------------------------------

export interface MetricOpportunity {
  id: string;
  accountId: string;
  status: string;
  /** Every amount on this record is in this currency and no other. */
  currency: string;
  estimatedValue: number | null;
  /** 0..1, from the stage's own probability. */
  probability: number | null;
  forecastCategory: string | null;
  health: string | null;
  stageEnteredAt?: Date | null;
  lastActivityAt?: Date | null;
  createdAt?: Date | null;
  firstProposalAt?: Date | null;
  wonValue?: number | null;
}

export interface MetricCosting {
  currency: string;
  totalCost: number;
  totalPrice: number;
}

export interface MetricApproval {
  requestedAt: Date;
}

export interface MetricSelectedQuotation {
  partnerId: string;
  value: number;
}

export interface MetricInputs {
  opportunities: readonly MetricOpportunity[];
  approvedCostings?: readonly MetricCosting[];
  pendingApprovals?: readonly MetricApproval[];
  selectedQuotations?: readonly MetricSelectedQuotation[];
  asOf?: Date;
}

export interface MetricValue {
  code: MetricCode;
  /**
   * Present for a money metric only when every record behind it shares one
   * currency. Otherwise it is null and `byCurrency` carries the answer --
   * adding EGP to USD produces a number that is not money in any currency,
   * and a screen showing 28,465,000 for 8.4M USD plus 20M EGP is not rounding
   * badly, it is stating something untrue.
   */
  value: number | null;
  unit: MetricDefinition['unit'];
  /** How many records the number rests on, so a 100% from one deal is visible. */
  basis: number;
  /**
   * Null value plus a reason: a metric with nothing to compute from is not
   * zero. Reporting zero would read as "we won nothing" when the truth is
   * "nothing has closed yet".
   */
  unavailableReason?: 'NO_DATA' | 'NOT_SUPPORTED' | 'MIXED_CURRENCY';
  /** Money metrics only: the amount per currency, never summed across them. */
  byCurrency?: Record<string, number>;
}

const round = (n: number) => Math.round(n * 100) / 100;

const OPEN = (o: MetricOpportunity) => o.status === 'ACTIVE' || o.status === 'ON_HOLD';
/**
 * A won deal.
 *
 * The status is CLOSED, not "WON": the schema has no WON, and the service that
 * closes a deal writes CLOSED with a forecast category of CLOSED_WON. This read
 * 'WON' for three releases, so win rate, average deal size and forecast
 * accuracy were all permanently null — and the unit tests agreed with the code
 * because their fixtures used the same status the database cannot hold. The
 * exhaustiveness test beside this one now ties the predicate to the published
 * list, so the two cannot drift apart again in silence.
 */
const WON = (o: MetricOpportunity) => o.status === 'CLOSED';
const LOST = (o: MetricOpportunity) => o.status === 'LOST';

function value(o: MetricOpportunity): number {
  return o.estimatedValue ?? 0;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return round(values.reduce((s, v) => s + v, 0) / values.length);
}

function daysBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / 86_400_000;
}

/** Largest single share of a total, as a percentage. */
function concentration(byKey: Map<string, number>): number | null {
  const total = [...byKey.values()].reduce((s, v) => s + v, 0);
  if (total <= 0) return null;
  const largest = Math.max(...byKey.values());
  return round((largest / total) * 100);
}

// ---------------------------------------------------------------------------
// Computation — one definition each
// ---------------------------------------------------------------------------

export function computeMetric(code: MetricCode, input: MetricInputs): MetricValue {
  const def = METRIC_DEFINITIONS[code];
  const asOf = input.asOf ?? new Date();
  const opps = input.opportunities;
  const open = opps.filter(OPEN);
  const won = opps.filter(WON);
  const lost = opps.filter(LOST);

  const result = (v: number | null, basis: number): MetricValue => ({
    code,
    value: v,
    unit: def.unit,
    basis,
    ...(v === null ? { unavailableReason: 'NO_DATA' as const } : {}),
  });

  /**
   * A money result, split by currency and only ever summed within one.
   *
   * `value` is filled when a single currency is in play, so the ordinary
   * single-currency case still reads as one number. With two, it is null and
   * the caller must show `byCurrency` -- there is no honest single figure to
   * fall back on.
   */
  const money = (
    rows: readonly { currency: string }[],
    amount: (row: never) => number,
    basis: number,
  ): MetricValue => {
    const byCurrency: Record<string, number> = {};
    for (const row of rows) {
      byCurrency[row.currency] = round((byCurrency[row.currency] ?? 0) + amount(row as never));
    }

    const currencies = Object.keys(byCurrency);
    if (currencies.length === 0) {
      return { code, value: null, unit: def.unit, basis, unavailableReason: 'NO_DATA', byCurrency };
    }
    if (currencies.length === 1) {
      return { code, value: byCurrency[currencies[0]], unit: def.unit, basis, byCurrency };
    }
    return {
      code,
      value: null,
      unit: def.unit,
      basis,
      unavailableReason: 'MIXED_CURRENCY',
      byCurrency,
    };
  };

  switch (code) {
    case 'PIPELINE_VALUE':
      return money(open, (o: MetricOpportunity) => value(o), open.length);

    case 'WEIGHTED_PIPELINE':
      // Probability comes from the stage, never typed in, so this cannot be
      // moved without moving the deal.
      return money(
        open,
        (o: MetricOpportunity) => value(o) * (o.probability ?? 0),
        open.length,
      );

    case 'WIN_RATE': {
      const decided = won.length + lost.length;
      // Open deals are in neither side: counting them as losses would make the
      // rate fall every time a salesperson finds work.
      return result(decided === 0 ? null : round((won.length / decided) * 100), decided);
    }

    case 'AVERAGE_DEAL_SIZE': {
      // An average over mixed currencies is not a smaller version of the same
      // error -- it is the same error divided by a count.
      const perCurrency: Record<string, { sum: number; n: number }> = {};
      for (const o of won) {
        const bucket = (perCurrency[o.currency] ??= { sum: 0, n: 0 });
        bucket.sum += value(o);
        bucket.n += 1;
      }
      const averages = Object.fromEntries(
        Object.entries(perCurrency).map(([c, b]) => [c, round(b.sum / b.n)]),
      );
      const currencies = Object.keys(averages);

      if (currencies.length === 0) {
        return { code, value: null, unit: def.unit, basis: 0, unavailableReason: 'NO_DATA' };
      }
      if (currencies.length === 1) {
        return { code, value: averages[currencies[0]], unit: def.unit, basis: won.length, byCurrency: averages };
      }
      return {
        code,
        value: null,
        unit: def.unit,
        basis: won.length,
        unavailableReason: 'MIXED_CURRENCY',
        byCurrency: averages,
      };
    }

    case 'GROSS_MARGIN': {
      const costings = input.approvedCostings ?? [];

      // A margin is a ratio, so mixing currencies inside it corrupts it just
      // as badly as inside a sum: the numerator and denominator would each be
      // an amount that exists in no currency.
      const perCurrency: Record<string, { price: number; cost: number }> = {};
      for (const c of costings) {
        const bucket = (perCurrency[c.currency] ??= { price: 0, cost: 0 });
        bucket.price += c.totalPrice;
        bucket.cost += c.totalCost;
      }

      const margins = Object.fromEntries(
        Object.entries(perCurrency)
          .filter(([, b]) => b.price > 0)
          // Over price, never over cost — the distinction Release 4 keeps.
          .map(([c, b]) => [c, round(((b.price - b.cost) / b.price) * 100)]),
      );
      const currencies = Object.keys(margins);

      if (currencies.length === 0) {
        return { code, value: null, unit: def.unit, basis: costings.length, unavailableReason: 'NO_DATA' };
      }
      if (currencies.length === 1) {
        return {
          code,
          value: margins[currencies[0]],
          unit: def.unit,
          basis: costings.length,
          byCurrency: margins,
        };
      }
      return {
        code,
        value: null,
        unit: def.unit,
        basis: costings.length,
        unavailableReason: 'MIXED_CURRENCY',
        byCurrency: margins,
      };
    }

    case 'STAGE_AGEING':
      return result(
        mean(
          open
            .filter((o) => o.stageEnteredAt)
            .map((o) => daysBetween(o.stageEnteredAt!, asOf)),
        ),
        open.filter((o) => o.stageEnteredAt).length,
      );

    case 'PROPOSAL_TURNAROUND': {
      const withBoth = opps.filter((o) => o.createdAt && o.firstProposalAt);
      return result(
        mean(withBoth.map((o) => daysBetween(o.createdAt!, o.firstProposalAt!))),
        withBoth.length,
      );
    }

    case 'FORECAST_ACCURACY': {
      const closed = [...won, ...lost];
      const committed = closed.filter((o) => o.forecastCategory === 'COMMIT');
      const committedValue = committed.reduce((s, o) => s + value(o), 0);
      if (committedValue <= 0) return result(null, committed.length);
      const wonOfCommitted = committed.filter(WON).reduce((s, o) => s + value(o), 0);
      return result(round((wonOfCommitted / committedValue) * 100), committed.length);
    }

    case 'CUSTOMER_CONCENTRATION': {
      const byAccount = new Map<string, number>();
      for (const o of won) {
        byAccount.set(o.accountId, (byAccount.get(o.accountId) ?? 0) + value(o));
      }
      return result(concentration(byAccount), byAccount.size);
    }

    case 'SUPPLIER_DEPENDENCY': {
      const byPartner = new Map<string, number>();
      for (const q of input.selectedQuotations ?? []) {
        byPartner.set(q.partnerId, (byPartner.get(q.partnerId) ?? 0) + q.value);
      }
      return result(concentration(byPartner), byPartner.size);
    }

    case 'OPEN_APPROVALS':
      return result((input.pendingApprovals ?? []).length, (input.pendingApprovals ?? []).length);

    case 'APPROVAL_WAIT': {
      const pending = input.pendingApprovals ?? [];
      return result(mean(pending.map((a) => daysBetween(a.requestedAt, asOf))), pending.length);
    }

    case 'AT_RISK_VALUE': {
      const red = open.filter((o) => o.health === 'RED');
      return money(red, (o: MetricOpportunity) => value(o), red.length);
    }

    case 'DORMANT_OPPORTUNITIES': {
      const dormant = open.filter(
        (o) => !o.lastActivityAt || daysBetween(o.lastActivityAt, asOf) >= DORMANT_AFTER_DAYS,
      );
      return result(dormant.length, open.length);
    }
  }
}

export function computeMetrics(
  codes: readonly MetricCode[],
  input: MetricInputs,
): MetricValue[] {
  return codes.map((code) => computeMetric(code, input));
}

// ---------------------------------------------------------------------------
// Which metrics each level is described as needing
// ---------------------------------------------------------------------------

/**
 * The spec's section 11 lists a dashboard per level. Only the metrics this
 * system can actually compute appear here; the rest of each list (cash flow,
 * bank guarantees, backlog, actual margin) needs the ERP and is reported as
 * pending rather than silently dropped from the screen.
 */
export const DASHBOARD_BY_ROLE: Record<string, readonly MetricCode[]> = {
  OWNER_BOARD: [
    'PIPELINE_VALUE',
    'WEIGHTED_PIPELINE',
    'GROSS_MARGIN',
    'CUSTOMER_CONCENTRATION',
    'SUPPLIER_DEPENDENCY',
    'AT_RISK_VALUE',
  ],
  CEO: [
    'WEIGHTED_PIPELINE',
    'WIN_RATE',
    'FORECAST_ACCURACY',
    'OPEN_APPROVALS',
    'APPROVAL_WAIT',
    'GROSS_MARGIN',
  ],
  SALES_DIRECTOR: [
    'PIPELINE_VALUE',
    'WEIGHTED_PIPELINE',
    'WIN_RATE',
    'STAGE_AGEING',
    'DORMANT_OPPORTUNITIES',
    'PROPOSAL_TURNAROUND',
  ],
  ACCOUNT_MANAGER: [
    'PIPELINE_VALUE',
    'AT_RISK_VALUE',
    'DORMANT_OPPORTUNITIES',
    'AVERAGE_DEAL_SIZE',
  ],
  FINANCE: ['GROSS_MARGIN', 'PIPELINE_VALUE', 'OPEN_APPROVALS', 'CUSTOMER_CONCENTRATION'],
  PROCUREMENT: ['SUPPLIER_DEPENDENCY', 'PIPELINE_VALUE'],
  OPERATIONS: ['WEIGHTED_PIPELINE', 'AT_RISK_VALUE', 'STAGE_AGEING'],
};

/** The default when a user's role has no dashboard of its own. */
export const DEFAULT_DASHBOARD: readonly MetricCode[] = [
  'PIPELINE_VALUE',
  'WEIGHTED_PIPELINE',
  'WIN_RATE',
  'AT_RISK_VALUE',
];

export function dashboardFor(roles: readonly string[]): readonly MetricCode[] {
  // The widest dashboard the person's roles entitle them to, rather than the
  // first: someone who is both CEO and finance should not lose half their
  // screen to whichever role happened to be listed first.
  const sets = roles.map((r) => DASHBOARD_BY_ROLE[r]).filter(Boolean);
  if (sets.length === 0) return DEFAULT_DASHBOARD;
  return [...new Set(sets.flat())];
}

/**
 * Metrics the spec's dashboards ask for that need the ERP link. Named so a
 * board member is told what is missing instead of assuming the screen is the
 * whole picture.
 */
export const PENDING_ERP_METRICS = [
  'ACTUAL_MARGIN_VS_BID_MARGIN',
  'CASH_FLOW_FORECAST',
  'WORKING_CAPITAL',
  'BANK_GUARANTEES',
  'CURRENCY_EXPOSURE',
  'BACKLOG',
] as const;
