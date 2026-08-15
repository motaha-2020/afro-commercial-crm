import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api';
import { getAccessToken } from '@/lib/session';
import { buildRefLabels, refLabel, type RefListPayload } from '@/lib/ref-labels';
import { ListFilters } from '@/components/ListFilters';
import { PartnerRowActions } from '@/components/PartnerRowActions';

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
  hasSelectedQuotation: boolean;
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

const APPROVAL_STATUSES = [
  'PROSPECT',
  'UNDER_QUALIFICATION',
  'APPROVED',
  'CONDITIONAL',
  'SUSPENDED',
];

const PAGE_SIZE = 25;

export default async function PartnersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const t = await getTranslations('partners');
  const token = await getAccessToken();

  const one = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : undefined);
  const filters = {
    search: one('search') ?? '',
    type: one('type') ?? '',
    country: one('country') ?? '',
    approvalStatus: one('approvalStatus') ?? '',
  };
  const page = Math.max(1, Number(one('page') ?? 1) || 1);

  // The API already scopes, filters and paginates. It was doing so all along —
  // this screen simply asked for 100 rows and sorted nothing, which is how a
  // supported filter goes unused for a release.
  const query = new URLSearchParams();
  if (filters.search) query.set('search', filters.search);
  if (filters.type) query.set('type', filters.type);
  if (filters.country) query.set('country', filters.country);
  if (filters.approvalStatus) query.set('approvalStatus', filters.approvalStatus);
  query.set('page', String(page));
  query.set('pageSize', String(PAGE_SIZE));

  const [{ items, total }, master] = await Promise.all([
    apiFetch<{ items: PartnerRow[]; total: number }>(`/partners?${query}`, { token }),
    apiFetch<{
      partnerTypes: string[];
      countries: string[];
      lists?: RefListPayload[];
    }>('/master-data', { token }),
  ]);

  const labels = buildRefLabels(master.lists, locale);
  const filtered = Boolean(
    filters.search || filters.type || filters.country || filters.approvalStatus,
  );

  // Counted from this page's rows, and only ever describing this page.
  const eligible = items.filter(
    (p) => !p.isBlacklisted && ['APPROVED', 'CONDITIONAL'].includes(p.approvalStatus),
  );

  const pageHref = (n: number) => {
    const q = new URLSearchParams(query);
    q.delete('pageSize');
    q.set('page', String(n));
    return `/${locale}/partners?${q}`;
  };

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
          <Link className="btn" href={`/${locale}/import/partners`}>
            {t('import')}
          </Link>
          <Link className="btn" href={`/${locale}/partners/new`}>
            + {t('newPartner')}
          </Link>
        </div>
      </div>

      <ListFilters
        basePath={`/${locale}/partners`}
        values={{
          search: filters.search,
          type: filters.type,
          country: filters.country,
          approvalStatus: filters.approvalStatus,
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
            label: t('types'),
            anyLabel: t('allTypes'),
            options: master.partnerTypes.map((c) => ({
              value: c,
              label: refLabel(labels, 'PARTNER_TYPE', c),
            })),
          },
          {
            kind: 'select',
            name: 'country',
            label: t('country'),
            anyLabel: t('allCountries'),
            options: master.countries.map((c) => ({
              value: c,
              label: refLabel(labels, 'COUNTRY', c),
            })),
          },
          {
            // Approval standing is a closed list decided by procurement and
            // finance; it is filtered on, never added to, from here.
            kind: 'select',
            name: 'approvalStatus',
            label: t('approvalStatus'),
            anyLabel: t('allStatuses'),
            options: APPROVAL_STATUSES.map((s) => ({ value: s, label: t(s) })),
          },
        ]}
      />

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
              <th />
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
                    {/* Partner types are administered now, so one added this
                        morning has to read as words without a code change. */}
                    {p.types.map((x) => (
                      <span key={x.id} className="badge badge-info">
                        {refLabel(labels, 'PARTNER_TYPE', x.type)}
                      </span>
                    ))}
                    {p.types.length === 0 && <span style={{ color: 'var(--muted)' }}>—</span>}
                  </div>
                </td>
                <td>{refLabel(labels, 'COUNTRY', p.country)}</td>
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
                <td>
                  <PartnerRowActions
                    id={p.id}
                    editHref={`/${locale}/partners/${p.id}`}
                    hasSelectedQuotation={p.hasSelectedQuotation}
                  />
                </td>
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
          <div className="list-foot">
            <span className="muted">
              {t('showing', {
                from: (page - 1) * PAGE_SIZE + 1,
                to: Math.min(page * PAGE_SIZE, total),
                total,
              })}
            </span>
            <div className="btn-row">
              {page > 1 && (
                <Link className="btn btn-sm" href={pageHref(page - 1)}>
                  {t('previous')}
                </Link>
              )}
              {page * PAGE_SIZE < total && (
                <Link className="btn btn-sm" href={pageHref(page + 1)}>
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
