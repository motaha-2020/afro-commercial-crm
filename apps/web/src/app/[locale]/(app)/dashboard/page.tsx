import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api';
import { getAccessToken } from '@/lib/session';
import { money } from '@/lib/format';

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

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations('dashboard');
  const stageT = await getTranslations('stage');
  const healthT = await getTranslations('health');
  const token = await getAccessToken();

  const { items } = await apiFetch<{ items: OppListItem[] }>('/opportunities', {
    token,
  });

  const totalValue = items.reduce(
    (sum, o) => sum + Number(o.estimatedValue ?? 0),
    0,
  );
  const active = items.filter((o) => o.status === 'ACTIVE').length;
  const atRisk = items.filter((o) => o.health === 'RED').length;

  const kpis = [
    { label: t('openPipeline'), value: money(totalValue) },
    { label: t('activeOpportunities'), value: String(active) },
    { label: t('atRisk'), value: String(atRisk) },
    { label: t('totalOpportunities'), value: String(items.length) },
  ];

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

      <div className="grid cols-4" style={{ marginBottom: 20 }}>
        {kpis.map((k) => (
          <div className="kpi" key={k.label}>
            <div className="label">{k.label}</div>
            <div className="value">{k.value}</div>
          </div>
        ))}
      </div>

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
