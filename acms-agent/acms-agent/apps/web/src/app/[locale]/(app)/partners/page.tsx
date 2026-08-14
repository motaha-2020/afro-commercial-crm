import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api';
import { getAccessToken } from '@/lib/session';

export const dynamic = 'force-dynamic';

interface PartnerRow {
  id: string;
  code: string;
  legalName: string;
  country: string;
  approvalStatus: string;
  isBlacklisted: boolean;
  overallRating: number | null;
  ratedDimensions: number;
  totalDimensions: number;
  types: { id: string; type: string }[];
  _count: { quotations: number };
}

const STATUS_BADGE: Record<string, string> = {
  PROSPECT: 'badge-info',
  UNDER_QUALIFICATION: 'badge-warning',
  APPROVED: 'badge-success',
  CONDITIONAL: 'badge-warning',
  SUSPENDED: 'badge-danger',
};

export default async function PartnersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations('partners');
  const token = await getAccessToken();

  const { items, total } = await apiFetch<{ items: PartnerRow[]; total: number }>(
    '/partners?pageSize=100',
    { token },
  );

  const eligible = items.filter(
    (p) => !p.isBlacklisted && ['APPROVED', 'CONDITIONAL'].includes(p.approvalStatus),
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('title')}</h1>
          <p>{t('subtitle')}</p>
        </div>
        <div className="head-actions">
          <span className="badge badge-primary">
            {eligible.length} / {total}
          </span>
          <Link className="btn" href={`/${locale}/partners/new`}>
            + {t('newPartner')}
          </Link>
        </div>
      </div>

      <div className="panel">
        <table className="data">
          <thead>
            <tr>
              <th>{t('code')}</th>
              <th>{t('name')}</th>
              <th>{t('types')}</th>
              <th>{t('country')}</th>
              <th>{t('approvalStatus')}</th>
              <th>{t('overall')}</th>
              <th>{t('quotations')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id}>
                <td>{p.code}</td>
                <td>
                  <Link
                    href={`/${locale}/partners/${p.id}`}
                    style={{ color: 'var(--primary)', fontWeight: 600 }}
                  >
                    {p.legalName}
                  </Link>
                  {p.isBlacklisted && (
                    <span className="badge badge-danger" style={{ marginInlineStart: 6 }}>
                      {t('blacklisted')}
                    </span>
                  )}
                </td>
                <td>
                  <div className="btn-row">
                    {p.types.map((x) => (
                      <span key={x.id} className="badge badge-info">
                        {t(x.type)}
                      </span>
                    ))}
                    {p.types.length === 0 && <span style={{ color: 'var(--muted)' }}>—</span>}
                  </div>
                </td>
                <td>{p.country}</td>
                <td>
                  <span className={`badge ${STATUS_BADGE[p.approvalStatus] ?? 'badge-info'}`}>
                    {t(p.approvalStatus)}
                  </span>
                </td>
                <td>
                  {p.overallRating ?? '—'}
                  {/* The denominator travels with the number: a 5 from one
                      scored dimension is not a five-star partner. */}
                  <span style={{ color: 'var(--muted)', fontSize: 11 }}>
                    {' '}
                    {t('ratedOf', { rated: p.ratedDimensions, total: p.totalDimensions })}
                  </span>
                </td>
                <td>{p._count.quotations}</td>
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
