import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api';
import { getAccessToken } from '@/lib/session';
import { money } from '@/lib/format';
import { buildRefLabels, refLabel, type RefListPayload } from '@/lib/ref-labels';
import { LeadRowActions } from '@/components/LeadRowActions';
import { ListFilters } from '@/components/ListFilters';

export const dynamic = 'force-dynamic';

interface LeadRow {
  id: string;
  code: string;
  name: string;
  status: string;
  source: string;
  country: string;
  archivedAt: string | null;
  convertedOpportunityId: string | null;
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

const STATUSES = ['NEW', 'WORKING', 'QUALIFIED', 'CONVERTED', 'DISQUALIFIED'];
const PAGE_SIZE = 25;

export default async function LeadsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const t = await getTranslations('leads');
  const token = await getAccessToken();

  // The URL is the filter. A filtered list can then be bookmarked and sent to
  // somebody else and still be the same list.
  const one = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : undefined);
  const filters = {
    search: one('search') ?? '',
    status: one('status') ?? '',
    source: one('source') ?? '',
    country: one('country') ?? '',
    includeArchived: one('includeArchived') === 'true',
  };
  const page = Math.max(1, Number(one('page') ?? 1) || 1);

  const query = new URLSearchParams();
  if (filters.search) query.set('search', filters.search);
  if (filters.status) query.set('status', filters.status);
  if (filters.source) query.set('source', filters.source);
  if (filters.country) query.set('country', filters.country);
  if (filters.includeArchived) query.set('includeArchived', 'true');
  query.set('page', String(page));
  query.set('pageSize', String(PAGE_SIZE));

  const [{ items, total }, master] = await Promise.all([
    apiFetch<{ items: LeadRow[]; total: number }>(`/leads?${query}`, { token }),
    apiFetch<{
      leadSources: string[];
      countries: string[];
      lists?: RefListPayload[];
    }>('/master-data', { token }),
  ]);

  const labels = buildRefLabels(master.lists, locale);
  const filtered =
    filters.search || filters.status || filters.source || filters.country;

  // Counted from this page's rows, and only ever describing this page — a
  // number in the corner that silently means something else is worse than none.
  const live = items.filter(
    (l) => l.status !== 'CONVERTED' && l.status !== 'DISQUALIFIED',
  );

  const pageHref = (n: number) => {
    const q = new URLSearchParams(query);
    q.delete('pageSize');
    q.set('page', String(n));
    return `/${locale}/leads?${q}`;
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
            {live.length} / {total}
          </span>
          <Link className="btn" href={`/${locale}/import/leads`}>
            {t('import')}
          </Link>
          <Link className="btn" href={`/${locale}/leads/new`}>
            + {t('newLead')}
          </Link>
        </div>
      </div>

      <ListFilters
        basePath={`/${locale}/leads`}
        values={{
          search: filters.search,
          status: filters.status,
          source: filters.source,
          country: filters.country,
          includeArchived: filters.includeArchived ? 'true' : '',
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
            name: 'status',
            label: t('status'),
            anyLabel: t('allStatuses'),
            options: STATUSES.map((s) => ({ value: s, label: t(s) })),
          },
          {
            kind: 'select',
            name: 'source',
            label: t('source'),
            anyLabel: t('allSources'),
            options: master.leadSources.map((s) => ({
              value: s,
              label: refLabel(labels, 'LEAD_SOURCE', s),
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
          { kind: 'toggle', name: 'includeArchived', label: t('showArchived') },
        ]}
      />

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
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((l) => (
              <tr key={l.id} style={{ opacity: l.archivedAt ? 0.55 : 1 }}>
                <td>{l.code}</td>
                <td>
                  <Link
                    href={`/${locale}/leads/${l.id}`}
                    style={{ color: 'var(--primary)', fontWeight: 600 }}
                  >
                    {l.name}
                  </Link>
                  {l.archivedAt && (
                    <span className="badge badge-warning" style={{ marginInlineStart: 6 }}>
                      {t('archived')}
                    </span>
                  )}
                </td>
                <td>
                  <span className={`badge ${STATUS_BADGE[l.status] ?? 'badge-info'}`}>
                    {t(l.status)}
                  </span>
                </td>
                {/* Sources are administered now, so a source added this morning
                    has to read as words here without a code change. */}
                <td>{refLabel(labels, 'LEAD_SOURCE', l.source)}</td>
                <td>{l.account?.legalName ?? '—'}</td>
                <td>{refLabel(labels, 'COUNTRY', l.country)}</td>
                <td>{money(l.estimatedValue, l.currency)}</td>
                <td>
                  <LeadRowActions
                    id={l.id}
                    archived={!!l.archivedAt}
                    converted={!!l.convertedOpportunityId}
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
