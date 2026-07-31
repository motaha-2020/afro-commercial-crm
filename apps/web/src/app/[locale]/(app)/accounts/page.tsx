import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api';
import { getAccessToken } from '@/lib/session';

export const dynamic = 'force-dynamic';

interface AccountRow {
  id: string;
  code: string;
  legalName: string;
  tradeName: string | null;
  type: string;
  country: string;
  creditStatus: string;
  owner: { fullNameEn: string; fullNameAr: string };
  _count: { contacts: number; opportunities: number };
}

export default async function AccountsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations('accounts');
  const token = await getAccessToken();

  const { items, total } = await apiFetch<{ items: AccountRow[]; total: number }>(
    '/accounts',
    { token },
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('title')}</h1>
          <p>{t('subtitle')}</p>
        </div>
        <div className="head-actions">
          <span className="badge badge-primary">{total}</span>
          <Link className="btn" href={`/${locale}/accounts/new`}>
            + {t('newAccount')}
          </Link>
        </div>
      </div>

      <div className="panel">
        <table className="data">
          <thead>
            <tr>
              <th>{t('code')}</th>
              <th>{t('name')}</th>
              <th>{t('type')}</th>
              <th>{t('country')}</th>
              <th>{t('owner')}</th>
              <th>{t('opportunities')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((a) => (
              <tr key={a.id}>
                <td>{a.code}</td>
                <td>
                  <Link href={`/${locale}/accounts/${a.id}`} style={{ color: 'var(--primary)', fontWeight: 600 }}>
                    {a.legalName}
                  </Link>
                </td>
                <td>{a.type}</td>
                <td>{a.country}</td>
                <td>{locale === 'ar' ? a.owner.fullNameAr : a.owner.fullNameEn}</td>
                <td>{a._count.opportunities}</td>
              </tr>
            ))}
            {items.length === 0 && (
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
