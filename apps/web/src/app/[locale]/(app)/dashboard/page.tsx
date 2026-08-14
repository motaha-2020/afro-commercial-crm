import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api';
import { getAccessToken } from '@/lib/session';
import { money } from '@/lib/format';
import { MetricCards, type MetricValue } from '@/components/MetricCards';

// Reads the caller's token and live pipeline — never prerender or cache.
export const dynamic = 'force-dynamic';

interface OppListItem {
  id: string;
  code: string;
  name: string;
  stage: string;
  status: string;
  forecastCategory: string;
  health: string;
  estimatedValue: string | null;
  currency: string;
  account: { legalName: string };
}

export default async function DashboardPage() {
  // Locale comes from the next-intl request context, not the route params —
  // every string on this page is resolved through getTranslations.
  const t = await getTranslations('dashboard');
  const stageT = await getTranslations('stage');
  const healthT = await getTranslations('health');
  const mt = await getTranslations('metrics');
  const token = await getAccessToken();

  const [{ items }, dashboard] = await Promise.all([
    apiFetch<{ items: OppListItem[] }>('/opportunities', { token }),
    // The metrics come from one central definition rather than being computed
    // here: the spec's whole reason for a semantic layer is that a figure
    // worked out on the page will disagree with the same figure worked out in
    // a report by the third quarter.
    apiFetch<{
      metrics: MetricValue[];
      pendingErpIntegration: string[];
    }>('/metrics/dashboard', { token }).catch(() => null),
  ]);

  const totalValue = items.reduce(
    (sum, o) => sum + Number(o.estimatedValue ?? 0),
    0,
  );
  const active = items.filter((o) => o.status === 'ACTIVE').length;
  const atRisk = items.filter((o) => o.health === 'RED').length;

  const top = [...items]
    .sort((a, b) => Number(b.estimatedValue ?? 0) - Number(a.estimatedValue ?? 0))
    .slice(0, 6);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('title')}</h1>
          <p>{t('subtitle')}</p>
        </div>
      </div>

      {dashboard ? (
        <MetricCards metrics={dashboard.metrics} currency="USD" />
      ) : (
        <div className="grid cols-4" style={{ marginBottom: 20 }}>
          <div className="kpi">
            <div className="label">{t('openPipeline')}</div>
            <div className="value">{money(totalValue)}</div>
          </div>
          <div className="kpi">
            <div className="label">{t('activeOpportunities')}</div>
            <div className="value">{String(active)}</div>
          </div>
          <div className="kpi">
            <div className="label">{t('atRisk')}</div>
            <div className="value">{String(atRisk)}</div>
          </div>
          <div className="kpi">
            <div className="label">{t('totalOpportunities')}</div>
            <div className="value">{String(items.length)}</div>
          </div>
        </div>
      )}

      {/* Named, not omitted: a board member should be told the screen is not
          the whole picture rather than left to assume it is. */}
      {dashboard && dashboard.pendingErpIntegration.length > 0 && (
        <p className="muted" style={{ marginBottom: 16 }}>
          {mt('awaitingErp')}:{' '}
          {dashboard.pendingErpIntegration.map((c) => mt(c)).join(' • ')}
        </p>
      )}

      <div className="panel">
        <h2 style={{ marginTop: 0, fontSize: 16 }}>{t('topOpportunities')}</h2>
        <table className="data">
          <thead>
            <tr>
              <th>{t('code')}</th>
              <th>{t('name')}</th>
              <th>{t('account')}</th>
              <th>{t('stage')}</th>
              <th>{t('health')}</th>
              <th>{t('value')}</th>
            </tr>
          </thead>
          <tbody>
            {top.map((o) => (
              <tr key={o.id}>
                <td>{o.code}</td>
                <td>{o.name}</td>
                <td>{o.account.legalName}</td>
                <td>{stageT(o.stage)}</td>
                <td>
                  <span className={`badge health-${o.health}`}>
                    {healthT(o.health)}
                  </span>
                </td>
                <td>{money(o.estimatedValue, o.currency)}</td>
              </tr>
            ))}
            {top.length === 0 && (
              <tr>
                <td colSpan={6} style={{ color: 'var(--muted)' }}>
                  {t('empty')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
