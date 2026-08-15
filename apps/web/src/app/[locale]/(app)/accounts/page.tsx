import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ACCOUNT_TYPES, COUNTRIES } from '@acms/shared';
import { apiFetch } from '@/lib/api';
import { getAccessToken } from '@/lib/session';
import { ListFilters } from '@/components/ListFilters';

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

/**
 * Credit standing that stops work belongs in the list, not only in the file:
 * the point of showing it is to be seen before someone opens an opportunity
 * on a customer we are not collecting from.
 */
function creditClass(status: string) {
  if (status === 'BLOCKED') return 'badge-danger';
  if (status === 'HOLD' || status === 'WATCH') return 'badge-warning';
  return 'badge-success';
}

export default async function AccountsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    search?: string;
    type?: string;
    country?: string;
    page?: string;
  }>;
}) {
  const { locale } = await params;
  const filters = await searchParams;
  const t = await getTranslations('accounts');
  const typeT = await getTranslations('accountType');
  const countryT = await getTranslations('country');
  const creditT = await getTranslations('creditStatus');
  const token = await getAccessToken();

  // Filtering happens in the API, which already scopes and paginates. Doing it
  // here would mean fetching the whole book to hide most of it.
  const query = new URLSearchParams();
  if (filters.search) query.set('search', filters.search);
  if (filters.type) query.set('type', filters.type);
  if (filters.country) query.set('country', filters.country);
  const page = Math.max(1, Number(filters.page ?? 1) || 1);
  if (page > 1) query.set('page', String(page));

  const { items, total, pageSize } = await apiFetch<{
    items: AccountRow[];
    total: number;
    page: number;
    pageSize: number;
  }>(`/accounts${query.toString() ? `?${query}` : ''}`, { token });

  const filtered = Boolean(filters.search || filters.type || filters.country);
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const hasPrevious = page > 1;
  const hasNext = to < total;

  const pageHref = (target: number) => {
    const next = new URLSearchParams(query);
    if (target > 1) next.set('page', String(target));
    else next.delete('page');
    return `/${locale}/accounts${next.toString() ? `?${next}` : ''}`;
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('title')}</h1>
          <p>{t('subtitle')}</p>
        </div>
        <div className="head-actions">
          <span className="badge badge-primary">{total}</span>
          <Link className="btn" href={`/${locale}/import/accounts`}>
            {t('import')}
          </Link>
          <Link className="btn" href={`/${locale}/accounts/new`}>
            + {t('newAccount')}
          </Link>
        </div>
      </div>

      {/* The filter lives in the URL, so a filtered list can be bookmarked and
          sent to someone else and still be the same list. */}
      <ListFilters
        basePath={`/${locale}/accounts`}
        values={{
          search: filters.search ?? '',
          type: filters.type ?? '',
          country: filters.country ?? '',
        }}
        fields={[
          {
            kind: 'search',
            name: 'search',
            label: t('search'),
            placeholder: t('searchPlaceholder'),
          },
          {
            kind: 'select',
            name: 'type',
            label: t('type'),
            anyLabel: t('allTypes'),
            options: ACCOUNT_TYPES.map((code) => ({ value: code, label: typeT(code) })),
          },
          {
            kind: 'select',
            name: 'country',
            label: t('country'),
            anyLabel: t('allCountries'),
            options: COUNTRIES.map((code) => ({ value: code, label: countryT(code) })),
          },
        ]}
      />

      <div className="panel">
        <table className="data">
          <thead>
            <tr>
              <th>{t('code')}</th>
              <th>{t('name')}</th>
              <th>{t('type')}</th>
              <th>{t('country')}</th>
              <th>{t('owner')}</th>
              <th>{t('creditStatus')}</th>
              <th>{t('contacts')}</th>
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
                <td>{typeT(a.type)}</td>
                <td>{countryT(a.country)}</td>
                <td>{locale === 'ar' ? a.owner.fullNameAr : a.owner.fullNameEn}</td>
                <td>
                  <span className={`badge ${creditClass(a.creditStatus)}`}>
                    {creditT(a.creditStatus)}
                  </span>
                </td>
                <td>{a._count.contacts}</td>
                <td>{a._count.opportunities}</td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={8} style={{ color: 'var(--muted)' }}>
                  {/* An empty book and a filter that matched nothing are
                      different facts, and only one of them is a problem. */}
                  {filtered ? t('noMatch') : t('empty')}
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {total > 0 && (
          <div className="list-pager">
            <span className="muted">{t('showing', { from, to, total })}</span>
            <div className="head-actions">
              {hasPrevious && (
                <Link className="btn btn-ghost" href={pageHref(page - 1)}>
                  {t('previous')}
                </Link>
              )}
              {hasNext && (
                <Link className="btn btn-ghost" href={pageHref(page + 1)}>
                  {t('next')}
                </Link>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
