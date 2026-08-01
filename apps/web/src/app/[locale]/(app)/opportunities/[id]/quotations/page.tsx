import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api';
import { getAccessToken } from '@/lib/session';
import {
  QuotationComparison,
  type ComparisonRow,
  type ComparisonViews,
} from '@/components/QuotationComparison';

export const dynamic = 'force-dynamic';

interface ComparisonPayload {
  views: ComparisonViews;
  quotations: ComparisonRow[];
  weights: Record<string, number>;
}

interface RfqRow {
  id: string;
  code: string;
  title: string;
  status: string;
  dueAt: string | null;
  recipients: { id: string; partner: { id: string; legalName: string } }[];
  _count: { quotations: number };
}

export default async function QuotationComparisonPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const t = await getTranslations('quotations');
  const token = await getAccessToken();

  let comparison: ComparisonPayload;
  try {
    comparison = await apiFetch<ComparisonPayload>(
      `/opportunities/${id}/quotation-comparison`,
      { token },
    );
  } catch {
    notFound();
  }

  const rfqs = await apiFetch<RfqRow[]>(`/opportunities/${id}/rfqs`, { token }).catch(
    () => [] as RfqRow[],
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('title')}</h1>
          <p>{t('subtitle')}</p>
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <QuotationComparison
          views={comparison.views}
          rows={comparison.quotations}
          weights={comparison.weights}
        />
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0, fontSize: 15 }}>{t('rfqs')}</h2>
        <table className="data">
          <thead>
            <tr>
              <th>{t('rfqCode')}</th>
              <th>{t('rfqTitle')}</th>
              <th>{t('rfqStatus')}</th>
              <th>{t('recipients')}</th>
              <th>{t('received')}</th>
              <th>{t('dueAt')}</th>
            </tr>
          </thead>
          <tbody>
            {rfqs.map((r) => (
              <tr key={r.id}>
                <td>{r.code}</td>
                <td>{r.title}</td>
                <td>
                  <span className="badge badge-info">{t(r.status)}</span>
                </td>
                <td>{r.recipients.map((x) => x.partner.legalName).join(', ') || '—'}</td>
                <td>
                  {/* Sent versus answered, side by side: an RFQ nobody replied
                      to is a different problem from one nobody was sent. */}
                  {r._count.quotations} / {r.recipients.length}
                </td>
                <td>{r.dueAt ? r.dueAt.slice(0, 10) : '—'}</td>
              </tr>
            ))}
            {rfqs.length === 0 && (
              <tr>
                <td colSpan={6} style={{ color: 'var(--muted)' }}>
                  {t('noRfqs')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p style={{ marginTop: 16 }}>
        <Link href={`/${locale}/opportunities/${id}`}>← {t('backToOpportunity')}</Link>
      </p>
    </>
  );
}
