import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api';
import { getAccessToken } from '@/lib/session';
import { money } from '@/lib/format';

export const dynamic = 'force-dynamic';

interface QueueRow {
  id: string;
  code: string;
  recordType: string;
  requestedAt: string;
  waitingHours: number;
  isLate: boolean;
  currentStep: { name: string; approverRole: string } | null;
  requestedBy: { id: string; fullNameEn: string; fullNameAr: string } | null;
  opportunity: {
    id: string;
    code: string;
    name: string;
    currency: string;
    estimatedValue: string | null;
  } | null;
  triggeredBy: {
    fired?: { conditionField: string; requiredRole: string }[];
    undetermined?: { ruleId: string; reason: string }[];
  } | null;
}

/**
 * "My Approvals" — the queue the spec asks for, showing value, who is waiting
 * and for how long, because an approval nobody can see the age of is an
 * approval that quietly expires.
 */
export default async function ApprovalsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations('approvals');
  const token = await getAccessToken();

  const queue = await apiFetch<QueueRow[]>('/approvals/my-queue', { token }).catch(
    () => [] as QueueRow[],
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('title')}</h1>
          <p>{t('subtitle')}</p>
        </div>
      </div>

      <div className="panel">
        <table className="data">
          <thead>
            <tr>
              <th>{t('reference')}</th>
              <th>{t('opportunity')}</th>
              <th>{t('value')}</th>
              <th>{t('step')}</th>
              <th>{t('requestedBy')}</th>
              <th>{t('waiting')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {queue.map((row) => (
              <tr key={row.id}>
                <td>{row.code}</td>
                <td>
                  {row.opportunity ? (
                    <Link href={`/${locale}/opportunities/${row.opportunity.id}`}>
                      {row.opportunity.name}
                    </Link>
                  ) : (
                    row.recordType
                  )}
                </td>
                <td>
                  {row.opportunity?.estimatedValue
                    ? money(Number(row.opportunity.estimatedValue), row.opportunity.currency)
                    : '—'}
                </td>
                <td>{row.currentStep?.name ?? '—'}</td>
                <td>{row.requestedBy?.fullNameEn ?? '—'}</td>
                <td>
                  {/* Late is worth its own colour: the SLA exists to be seen. */}
                  <span className={`badge ${row.isLate ? 'badge-warn' : ''}`}>
                    {t('hours', { n: row.waitingHours })}
                  </span>
                </td>
                <td>
                  <Link className="btn btn-sm btn-ghost" href={`/${locale}/approvals/${row.id}`}>
                    {t('open')}
                  </Link>
                </td>
              </tr>
            ))}
            {queue.length === 0 && (
              <tr>
                <td colSpan={7} style={{ color: 'var(--muted)' }}>
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
