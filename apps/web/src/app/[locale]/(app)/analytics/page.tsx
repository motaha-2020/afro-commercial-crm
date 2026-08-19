import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api';
import { getAccessToken } from '@/lib/session';
import { money } from '@/lib/format';
import { BarChart, LineChart, ShareBar } from '@/components/Charts';
import { ListFilters } from '@/components/ListFilters';

export const dynamic = 'force-dynamic';

interface Grouped {
  key: string;
  count: number;
  value: number;
}

interface Analytics {
  filters: Record<string, string | null>;
  totals: {
    opportunities: number;
    openValue: number;
    weightedValue: number;
    wonValue: number;
    won: number;
    lost: number;
    winRate: number | null;
  };
  byStage: (Grouped & { order: number })[];
  byCountry: Grouped[];
  byIndustry: Grouped[];
  byMonth: { month: string; created: number; won: number; lost: number; wonValue: number }[];
  topAccounts: (Grouped & { share: number })[];
}

/**
 * The analytical dashboard.
 *
 * Filtering happens on the server through the URL rather than in the browser
 * over a payload of every opportunity. Two reasons, and the second is the real
 * one: a client-side filter needs the unfiltered data in the page to filter it,
 * which would send every deal to every reader and undo the scope rules the
 * whole system is built on. The URL also makes a view shareable — "the Kenya
 * pipeline this quarter" is a link rather than a description of six clicks.
 */
export default async function AnalyticsPage({
  params: routeParams,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { locale } = await routeParams;
  const params = await searchParams;
  const t = await getTranslations('analytics');
  const stageT = await getTranslations('stage');
  const countryT = await getTranslations('country');
  const industryT = await getTranslations('industry');
  const token = await getAccessToken();

  const query = new URLSearchParams();
  for (const key of ['from', 'to', 'country', 'industry', 'stage'] as const) {
    if (params[key]) query.set(key, params[key] as string);
  }

  const data = await apiFetch<Analytics>(
    `/metrics/analytics${query.toString() ? `?${query}` : ''}`,
    { token },
  ).catch(() => null);

  if (!data) {
    return (
      <div className="panel">
        <p className="muted">{t('failed')}</p>
      </div>
    );
  }

  const { totals } = data;
  const currency = 'USD';

  // Read from the reference data rather than from the filtered response: once
  // Kenya is selected the response contains only Kenya, and a filter whose
  // options shrink to the current selection cannot be changed, only cleared.
  const options = await apiFetch<{ countries: string[]; industries: string[] }>('/master-data', {
    token,
  }).catch(() => ({ countries: [] as string[], industries: [] as string[] }));

  const { countries, industries } = options;
  const stages = data.byStage.map((s) => s.key);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('title')}</h1>
          <p>{t('subtitle')}</p>
        </div>
      </div>

      {/* The same filter bar every list screen uses. A second one built for
          this page would drift from it in a month, and the URL-as-truth
          behaviour — bookmarkable, shareable, back-button-correct — is already
          solved there. */}
      <ListFilters
        basePath={`/${locale}/analytics`}
        values={{
          from: params.from ?? '',
          to: params.to ?? '',
          country: params.country ?? '',
          industry: params.industry ?? '',
          stage: params.stage ?? '',
        }}
        fields={[
          { kind: 'date', name: 'from', label: t('from') },
          { kind: 'date', name: 'to', label: t('to') },
          {
            kind: 'select',
            name: 'country',
            label: t('country'),
            anyLabel: t('allCountries'),
            options: countries.map((c) => ({ value: c, label: countryT(c) })),
          },
          {
            kind: 'select',
            name: 'industry',
            label: t('industry'),
            anyLabel: t('allIndustries'),
            options: industries.map((i) => ({ value: i, label: industryT(i) })),
          },
          {
            kind: 'select',
            name: 'stage',
            label: t('stage'),
            anyLabel: t('allStages'),
            options: stages.map((s) => ({ value: s, label: stageT(s) })),
          },
        ]}
      />

      <div className="grid cols-3" style={{ marginBottom: 20 }}>
        <div className="kpi">
          <div className="label">{t('openValue')}</div>
          <div className="value">{money(totals.openValue, currency)}</div>
          <div className="trend">{t('records', { n: totals.opportunities })}</div>
        </div>
        <div className="kpi">
          <div className="label">{t('weighted')}</div>
          <div className="value">{money(totals.weightedValue, currency)}</div>
          <div className="trend">{t('weightedHint')}</div>
        </div>
        <div className="kpi">
          <div className="label">{t('winRate')}</div>
          {/* Nothing closed is not a win rate of zero. */}
          <div
            className="value"
            style={totals.winRate === null ? { color: 'var(--muted)' } : undefined}
          >
            {totals.winRate === null ? t('notYet') : `${totals.winRate}%`}
          </div>
          <div className="trend">{t('wonLost', { won: totals.won, lost: totals.lost })}</div>
        </div>
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0, fontSize: 15 }}>{t('byStage')}</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          {t('byStageHint')}
        </p>
        <BarChart
          data={data.byStage.map((s) => ({
            key: s.key,
            label: stageT(s.key),
            value: s.value,
            hint: t('deals', { n: s.count }),
          }))}
        />
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0, fontSize: 15 }}>{t('overTime')}</h2>
        <LineChart
          points={data.byMonth.map((m) => m.month)}
          series={[
            { key: 'created', label: t('created'), values: data.byMonth.map((m) => m.created) },
            { key: 'won', label: t('won'), values: data.byMonth.map((m) => m.won) },
            { key: 'lost', label: t('lost'), values: data.byMonth.map((m) => m.lost) },
          ]}
        />
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0, fontSize: 15 }}>{t('concentration')}</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          {t('concentrationHint')}
        </p>
        <ShareBar
          data={data.topAccounts.map((a) => ({
            key: a.key,
            label: a.key,
            value: a.value,
            share: a.share,
          }))}
        />
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0, fontSize: 15 }}>{t('byCountry')}</h2>
        <BarChart
          data={data.byCountry.map((c) => ({
            key: c.key,
            label: c.key === '—' ? '—' : countryT(c.key),
            value: c.value,
            hint: t('deals', { n: c.count }),
          }))}
        />
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0, fontSize: 15 }}>{t('byIndustry')}</h2>
        <BarChart
          data={data.byIndustry.map((i) => ({
            key: i.key,
            label: i.key === '—' ? '—' : industryT(i.key),
            value: i.value,
            hint: t('deals', { n: i.count }),
          }))}
        />
      </div>
    </>
  );
}
