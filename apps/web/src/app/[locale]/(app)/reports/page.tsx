import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api';
import { getAccessToken } from '@/lib/session';
import { ReportBuilder, type ReportMetric } from '@/components/ReportBuilder';

export const dynamic = 'force-dynamic';

/**
 * Reports over the measures the system already defines.
 *
 * The first load is the reader's own dashboard rather than an empty screen: the
 * metrics they are entitled to, already computed, so the page opens on
 * something true instead of on a form.
 */
export default async function ReportsPage() {
  const t = await getTranslations('reports');
  const token = await getAccessToken();

  const dashboard = await apiFetch<{ metrics: ReportMetric[] }>('/metrics/dashboard', {
    token,
  }).catch(() => ({ metrics: [] as ReportMetric[] }));

  const available = dashboard.metrics.map((m) => m.code);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('title')}</h1>
          <p>{t('subtitle')}</p>
        </div>
      </div>

      <ReportBuilder available={available} initial={dashboard.metrics} />
    </>
  );
}
