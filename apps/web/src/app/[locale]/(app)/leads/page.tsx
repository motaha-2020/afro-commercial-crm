import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api';
import { getAccessToken } from '@/lib/session';
import { money } from '@/lib/format';

export const dynamic = 'force-dynamic';

interface LeadRow {
  id: string;
  code: string;
  name: string;
  status: string;
  source: string;
  country: string;
  estimatedValue: string | null;
  currency: string;
  account: { id: string; legalName: string } | null;
  owner: { fullNameEn: string; fullNameAr: string };
}

const STATUS_BADGE: Record<string, string> = {
  NEW: 'badge-info',
  WORKING: 'badge-primary',
  QUALIFIED: 'badge-success',
  CONVERTED: 'badge-success',
  DISQUALIFIED: 'badge-danger',
};

export default async function LeadsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations('leads');
  const token = await getAccessToken();

  const { items, total } = await apiFetch<{ items: LeadRow[]; total: number }>('/leads', {
    token,
  });

  // A lead that is neither converted nor disqualified is still someone's job.
  const live = items.filter((l) => l.status !== 'CONVERTED' && l.status !== 'DISQUALIFIED');

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('title')}</h1>
          <p>{t('subtitle')}</p>
        </div>
        <div className="head-actions">
          <span className="badge badge-primary">
            {live.length} / {total}
          </span>
          <Link className="btn" href={`/${locale}/leads/new`}>
            + {t('newLead')}
          </Link>
        </div>
      </div>

      <div className="panel">
        <table className="data">
          <thead>
            <tr>
              <th>{t('code')}</th>
              <th>{t('name')}</th>
              <th>{t('status')}</th>
              <th>{t('source')}</th>
              <th>{t('account')}</th>
              <th>{t('country')}</th>
              <th>{t('value')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((l) => (
              <tr key={l.id}>
                <td>{l.code}</td>
                <td>
                  <Link
                    href={`/${locale}/leads/${l.id}`}
                    style={{ color: 'var(--primary)', fontWeight: 600 }}
                  >
                    {l.name}
                  </Link>
                </td>
                <td>
                  <span className={`badge ${STATUS_BADGE[l.status] ?? 'badge-info'}`}>
                    {t(l.status)}
                  </span>
                </td>
                <td>{t(l.source)}</td>
                <td>{l.account?.legalName ?? '—'}</td>
                <td>{l.country}</td>
                <td>{money(l.estimatedValue, l.currency)}</td>
              </tr>
            ))}
            {items.length === 0 && (
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
