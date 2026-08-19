import {
  DASHBOARD_BY_ROLE,
  DEFAULT_DASHBOARD,
  METRIC_CODES,
  METRIC_DEFINITIONS,
  computeMetric,
  dashboardFor,
  type MetricInputs,
  type MetricOpportunity,
} from './metrics';
import { OPPORTUNITY_STATUSES } from './opportunity';

const NOW = new Date('2026-08-01');

function opp(over: Partial<MetricOpportunity> = {}): MetricOpportunity {
  return {
    id: 'o1',
    accountId: 'acc-1',
    status: 'ACTIVE',
    estimatedValue: 100_000,
    probability: 0.5,
    forecastCategory: 'PIPELINE',
    health: 'GREEN',
    ...over,
  };
}

const at = (input: Partial<MetricInputs>): MetricInputs => ({
  opportunities: [],
  asOf: NOW,
  ...input,
});

describe('the catalogue itself', () => {
  it('defines every metric it lists', () => {
    for (const code of METRIC_CODES) {
      expect(METRIC_DEFINITIONS[code]).toBeDefined();
      expect(METRIC_DEFINITIONS[code].formula.length).toBeGreaterThan(0);
    }
  });

  it('answers the KPI gate for each: decision, owner, and whether it can be gamed', () => {
    // Section 30's questions. The third is the one people skip, and a metric
    // someone can move without doing the work will be moved without the work.
    for (const code of METRIC_CODES) {
      const def = METRIC_DEFINITIONS[code];
      expect(def.decision.length).toBeGreaterThan(0);
      expect(def.owner.length).toBeGreaterThan(0);
      expect(typeof def.gameable).toBe('boolean');
      if (def.gameable) expect(def.gamingNote?.length).toBeGreaterThan(0);
    }
  });
});

describe('win rate — the spec\'s worked example', () => {
  it('is won over won plus lost', () => {
    const result = computeMetric(
      'WIN_RATE',
      at({
        opportunities: [
          opp({ status: 'CLOSED' }),
          opp({ status: 'CLOSED' }),
          opp({ status: 'LOST' }),
          opp({ status: 'LOST' }),
        ],
      }),
    );

    expect(result.value).toBe(50);
    expect(result.basis).toBe(4);
  });

  it('leaves open deals out of both sides', () => {
    // Counting them as losses would make the rate fall every time a
    // salesperson finds work.
    const result = computeMetric(
      'WIN_RATE',
      at({ opportunities: [opp({ status: 'CLOSED' }), opp({ status: 'ACTIVE' })] }),
    );

    expect(result.value).toBe(100);
    expect(result.basis).toBe(1);
  });

  it('is unavailable rather than zero when nothing has closed', () => {
    // Zero would read as "we won nothing"; the truth is "nothing has closed".
    const result = computeMetric('WIN_RATE', at({ opportunities: [opp()] }));

    expect(result.value).toBeNull();
    expect(result.unavailableReason).toBe('NO_DATA');
  });
});

describe('pipeline', () => {
  it('sums only the open deals', () => {
    const result = computeMetric(
      'PIPELINE_VALUE',
      at({
        opportunities: [
          opp({ estimatedValue: 100 }),
          opp({ status: 'CLOSED', estimatedValue: 900 }),
        ],
      }),
    );

    expect(result.value).toBe(100);
  });

  it('weights by the stage probability, which nobody types in', () => {
    const result = computeMetric(
      'WEIGHTED_PIPELINE',
      at({
        opportunities: [
          opp({ estimatedValue: 100_000, probability: 0.25 }),
          opp({ estimatedValue: 100_000, probability: 0.75 }),
        ],
      }),
    );

    expect(result.value).toBe(100_000);
  });

  it('treats a missing probability as nothing rather than guessing one', () => {
    const result = computeMetric(
      'WEIGHTED_PIPELINE',
      at({ opportunities: [opp({ estimatedValue: 100_000, probability: null })] }),
    );

    expect(result.value).toBe(0);
  });
});

describe('gross margin', () => {
  it('is over price, never over cost', () => {
    // Cost 100, price 125 → margin 20%, markup 25%. The distinction Release 4
    // exists to keep.
    const result = computeMetric(
      'GROSS_MARGIN',
      at({ opportunities: [], approvedCostings: [{ totalCost: 100, totalPrice: 125 }] }),
    );

    expect(result.value).toBe(20);
  });

  it('is unavailable when nothing is approved yet', () => {
    expect(computeMetric('GROSS_MARGIN', at({})).value).toBeNull();
  });
});

describe('concentration', () => {
  it('reports the largest customer\'s share of won value', () => {
    const result = computeMetric(
      'CUSTOMER_CONCENTRATION',
      at({
        opportunities: [
          opp({ status: 'CLOSED', accountId: 'a', estimatedValue: 750 }),
          opp({ status: 'CLOSED', accountId: 'b', estimatedValue: 250 }),
        ],
      }),
    );

    expect(result.value).toBe(75);
    // Two customers behind it; one customer at 100% would be a different fact.
    expect(result.basis).toBe(2);
  });

  it('reports supplier dependency the same way', () => {
    const result = computeMetric(
      'SUPPLIER_DEPENDENCY',
      at({
        selectedQuotations: [
          { partnerId: 'p1', value: 900 },
          { partnerId: 'p2', value: 100 },
        ],
      }),
    );

    expect(result.value).toBe(90);
  });
});

describe('the ones that show neglect', () => {
  it('counts an opportunity with no activity for 30 days as dormant', () => {
    const result = computeMetric(
      'DORMANT_OPPORTUNITIES',
      at({
        opportunities: [
          opp({ lastActivityAt: new Date('2026-06-01') }),
          opp({ lastActivityAt: new Date('2026-07-30') }),
        ],
      }),
    );

    expect(result.value).toBe(1);
  });

  it('counts one that never had an activity at all', () => {
    const result = computeMetric(
      'DORMANT_OPPORTUNITIES',
      at({ opportunities: [opp({ lastActivityAt: null })] }),
    );

    expect(result.value).toBe(1);
  });

  it('sums the value of red deals while there is still time to act', () => {
    const result = computeMetric(
      'AT_RISK_VALUE',
      at({
        opportunities: [
          opp({ health: 'RED', estimatedValue: 400 }),
          opp({ health: 'GREEN', estimatedValue: 600 }),
        ],
      }),
    );

    expect(result.value).toBe(400);
  });

  it('averages how long pending approvals have waited', () => {
    const result = computeMetric(
      'APPROVAL_WAIT',
      at({
        pendingApprovals: [
          { requestedAt: new Date('2026-07-30') },
          { requestedAt: new Date('2026-07-28') },
        ],
      }),
    );

    expect(result.value).toBe(3);
  });
});

describe('forecast accuracy', () => {
  it('measures committed value that actually landed', () => {
    const result = computeMetric(
      'FORECAST_ACCURACY',
      at({
        opportunities: [
          opp({ status: 'CLOSED', forecastCategory: 'COMMIT', estimatedValue: 700 }),
          opp({ status: 'LOST', forecastCategory: 'COMMIT', estimatedValue: 300 }),
          // Never committed, so it belongs to neither side of the question.
          opp({ status: 'LOST', forecastCategory: 'PIPELINE', estimatedValue: 999 }),
        ],
      }),
    );

    expect(result.value).toBe(70);
    expect(result.basis).toBe(2);
  });

  it('is unavailable when nothing was ever committed', () => {
    // Forecasting nothing makes accuracy meaningless, not perfect.
    const result = computeMetric(
      'FORECAST_ACCURACY',
      at({ opportunities: [opp({ status: 'CLOSED', forecastCategory: 'PIPELINE' })] }),
    );

    expect(result.value).toBeNull();
  });
});

describe('which dashboard a person sees', () => {
  it('gives each named role the metrics its level is described as needing', () => {
    expect(DASHBOARD_BY_ROLE.CEO).toContain('FORECAST_ACCURACY');
    expect(DASHBOARD_BY_ROLE.PROCUREMENT).toContain('SUPPLIER_DEPENDENCY');
    expect(DASHBOARD_BY_ROLE.OWNER_BOARD).toContain('CUSTOMER_CONCENTRATION');
  });

  it('unions the roles rather than picking the first', () => {
    // Someone who is both should not lose half their screen to ordering.
    const both = dashboardFor(['PROCUREMENT', 'CEO']);

    expect(both).toContain('SUPPLIER_DEPENDENCY');
    expect(both).toContain('FORECAST_ACCURACY');
  });

  it('does not repeat a metric two roles share', () => {
    const both = dashboardFor(['CEO', 'SALES_DIRECTOR']);
    expect(new Set(both).size).toBe(both.length);
  });

  it('falls back to a usable default for an unlisted role', () => {
    expect(dashboardFor(['SYSTEM_ADMIN'])).toEqual(DEFAULT_DASHBOARD);
  });
});


describe('the vocabulary the metrics read', () => {
  it('every status the metrics test for is a status the system can actually hold', () => {
    // The bug this pins: WON was read for three releases and never existed.
    // Win rate, average deal size and forecast accuracy were all null, and the
    // tests passed because the fixtures invented the same value.
    const statusesUsedByMetrics = ['ACTIVE', 'ON_HOLD', 'CLOSED', 'LOST'];
    for (const status of statusesUsedByMetrics) {
      expect(OPPORTUNITY_STATUSES).toContain(status);
    }
  });

  it('and a closed deal counts as won', () => {
    const result = computeMetric(
      'WIN_RATE',
      at({ opportunities: [opp({ status: 'CLOSED' }), opp({ status: 'LOST' })] }),
    );
    expect(result.value).toBe(50);
  });
});
