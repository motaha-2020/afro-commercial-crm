/**
 * Sales targets, and what a person has actually done against one.
 *
 * The arithmetic is here rather than in a service so it can be tested without
 * a database, and so the API and any future report reach the same number the
 * screen shows. Everything below is pure.
 */

export const TARGET_METRICS = ['WON_VALUE', 'WON_COUNT', 'PIPELINE_VALUE'] as const;
export type TargetMetric = (typeof TARGET_METRICS)[number];

export const TARGET_PERIODS = ['MONTH', 'QUARTER', 'YEAR'] as const;
export type TargetPeriod = (typeof TARGET_PERIODS)[number];

/** Which metrics are money, and therefore meaningless without a currency. */
export const MONEY_METRICS: readonly TargetMetric[] = ['WON_VALUE', 'PIPELINE_VALUE'];

export function isMoneyMetric(metric: TargetMetric): boolean {
  return MONEY_METRICS.includes(metric);
}

export interface SalesTarget {
  id: string;
  userId?: string | null;
  orgUnitId?: string | null;
  period: TargetPeriod;
  periodStart: Date;
  metric: TargetMetric;
  currency?: string | null;
  value: number;
}

/** One opportunity, as much of it as a target needs. */
export interface TargetOpportunity {
  ownerId: string;
  orgUnitId: string;
  status: string;
  currency: string;
  estimatedValue: number | null;
  /** When it closed. Null while it is still open. */
  closedAt?: Date | null;
}

export interface TargetProgress {
  target: SalesTarget;
  /** Where the period runs from and to — the window the actual is measured in. */
  window: { from: Date; to: Date };
  /**
   * What has been achieved. Null when the target cannot be measured rather
   * than zero: a target in USD against a book with no USD deals has no
   * achievement, and calling that 0% would read as failure rather than as
   * "this target does not describe this book".
   */
  actual: number | null;
  /** Percent of target. Null whenever `actual` is, or the target is zero. */
  attainmentPercent: number | null;
  /** How many records the actual rests on, so a number from one deal is visible. */
  basis: number;
  unmeasurableReason?: 'NO_MATCHING_CURRENCY' | 'TARGET_IS_ZERO';
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * The window a period covers, from its first instant to the first instant of
 * the next one.
 *
 * Half-open on purpose: a deal closed at midnight on the first of April
 * belongs to April, and two adjacent windows that both claim it would let one
 * deal fill two quarters.
 */
export function periodWindow(period: TargetPeriod, start: Date): { from: Date; to: Date } {
  const from = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()),
  );
  const to = new Date(from);

  switch (period) {
    case 'MONTH':
      to.setUTCMonth(to.getUTCMonth() + 1);
      break;
    case 'QUARTER':
      to.setUTCMonth(to.getUTCMonth() + 3);
      break;
    case 'YEAR':
      to.setUTCFullYear(to.getUTCFullYear() + 1);
      break;
  }

  return { from, to };
}

/** A deal that closed won. CLOSED is the win: the schema has no WON. */
const isWon = (o: TargetOpportunity) => o.status === 'CLOSED';
const isOpen = (o: TargetOpportunity) => o.status === 'ACTIVE' || o.status === 'ON_HOLD';

const amount = (o: TargetOpportunity) => o.estimatedValue ?? 0;

/**
 * Progress against one target.
 *
 * Only the opportunities the target is actually about are counted: its owner's
 * if it names a person, its unit's if it names one. A target that named both
 * would be counted twice on any roll-up, which is why the schema forbids it.
 */
export function progressFor(
  target: SalesTarget,
  opportunities: readonly TargetOpportunity[],
): TargetProgress {
  const window = periodWindow(target.period, target.periodStart);

  const mine = opportunities.filter((o) => {
    if (target.userId) return o.ownerId === target.userId;
    if (target.orgUnitId) return o.orgUnitId === target.orgUnitId;
    return false;
  });

  // Money targets count only their own currency. Converting would invent a
  // rate; summing across would produce an amount that is money in no currency.
  const inScope = isMoneyMetric(target.metric)
    ? mine.filter((o) => o.currency === target.currency)
    : mine;

  const counted =
    target.metric === 'PIPELINE_VALUE'
      ? // Pipeline is a standing balance, not something accumulated over the
        // period: what is open now, not what opened during it.
        inScope.filter(isOpen)
      : inScope.filter(
          (o) => isWon(o) && o.closedAt && o.closedAt >= window.from && o.closedAt < window.to,
        );

  if (isMoneyMetric(target.metric) && !mine.some((o) => o.currency === target.currency)) {
    return {
      target,
      window,
      actual: null,
      attainmentPercent: null,
      basis: 0,
      unmeasurableReason: 'NO_MATCHING_CURRENCY',
    };
  }

  const actual =
    target.metric === 'WON_COUNT' ? counted.length : round(counted.reduce((s, o) => s + amount(o), 0));

  if (target.value <= 0) {
    // Attainment against zero is not infinite and not 100%; it is a target
    // nobody can be measured against.
    return {
      target,
      window,
      actual,
      attainmentPercent: null,
      basis: counted.length,
      unmeasurableReason: 'TARGET_IS_ZERO',
    };
  }

  return {
    target,
    window,
    actual,
    attainmentPercent: round((actual / target.value) * 100),
    basis: counted.length,
  };
}

/**
 * How a reader should see an attainment.
 *
 * Bands rather than a raw percentage so the screen can say something without
 * the reader doing arithmetic. Deliberately not a status colour on its own:
 * being behind in month one of a year is not the same finding as being behind
 * in month twelve, and the band never claims to know which it is.
 */
export type AttainmentBand = 'ahead' | 'on_track' | 'behind' | 'at_risk';

export function attainmentBand(percent: number): AttainmentBand {
  if (percent >= 100) return 'ahead';
  if (percent >= 85) return 'on_track';
  if (percent >= 60) return 'behind';
  return 'at_risk';
}

/**
 * How far through the period we are, as a percentage.
 *
 * The number that makes an attainment mean anything: 40% of a target is ahead
 * in March and a crisis in December, and a screen showing attainment alone
 * cannot tell the two apart.
 */
export function periodElapsedPercent(
  period: TargetPeriod,
  periodStart: Date,
  asOf: Date,
): number {
  const { from, to } = periodWindow(period, periodStart);
  if (asOf <= from) return 0;
  if (asOf >= to) return 100;
  return round(((asOf.getTime() - from.getTime()) / (to.getTime() - from.getTime())) * 100);
}
