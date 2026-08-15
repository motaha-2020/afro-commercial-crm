import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api';
import { getAccessToken } from '@/lib/session';
import { money } from '@/lib/format';
import { ListFilters } from '@/components/ListFilters';

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

interface QueueFilterOptions {
  recordTypes: string[];
  requesters: { id: string; fullNameEn: string; fullNameAr: string }[];
}

const STATUSES = [
  'PENDING',
  'APPROVED',
  'APPROVED_WITH_CONDITIONS',
  'REJECTED',
  'RETURNED_FOR_REVISION',
  'CANCELLED',
];

/**
 * "My Approvals" — the queue the spec asks for, showing value, who is waiting
 * and for how long, because an approval nobody can see the age of is an
 * approval that quietly expires.
 *
 * There is no edit and no delete here, and there never will be. An approval
 * decision is a governance record: the point of it is that it says what was
 * decided, by whom and when, and a record that can be rewritten afterwards
 * answers none of those questions. A decision that was wrong is corrected by
 * raising the next one, not by editing the last.
 */
export default async function ApprovalsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const t = await getTranslations('approvals');
  const token = await getAccessToken();

  const one = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : undefined);
  const filters = {
    status: one('status') ?? '',
    recordType: one('recordType') ?? '',
    requestedById: one('requestedById') ?? '',
    from: one('from') ?? '',
    to: one('to') ?? '',
  };

  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v) query.set(k, v);

  const [queue, options] = await Promise.all([
    apiFetch<QueueRow[]>(
      `/approvals/my-queue${query.toString() ? `?${query}` : ''}`,
      { token },
    ).catch(() => [] as QueueRow[]),
    // Options come from the whole queue, not from the rows on screen: a
    // dropdown built from filtered results loses every other choice the moment
    // one is made, and leaves no way back.
    apiFetch<QueueFilterOptions>('/approvals/my-queue/filters', { token }).catch(
      () => ({ recordTypes: [], requesters: [] }) as QueueFilterOptions,
    ),
  ]);

  const filtered = Object.values(filters).some(Boolean);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('title')}</h1>
          <p>{t('subtitle')}</p>
        </div>
      </div>

      <ListFilters
        basePath={`/${locale}/approvals`}
        values={filters}
        fields={[
          {
            // Closed list: these are the states the workflow can put a request
            // in, not a vocabulary anyone adds to from a screen.
            kind: 'select',
            name: 'status',
            label: t('status'),
            anyLabel: t('statusDefault'),
            options: STATUSES.map((s) => ({ value: s, label: t(s) })),
          },
          {
            kind: 'select',
            name: 'recordType',
            label: t('recordType'),
            anyLabel: t('allRecordTypes'),
            options: options.recordTypes.map((r) => ({ value: r, label: r })),
          },
          {
            kind: 'select',
            name: 'requestedById',
            label: t('requestedBy'),
            anyLabel: t('allRequesters'),
            options: options.requesters.map((u) => ({
              value: u.id,
              label: locale === 'ar' ? u.fullNameAr : u.fullNameEn,
            })),
          },
          { kind: 'date', name: 'from', label: t('from') },
          { kind: 'date', name: 'to', label: t('to') },
        ]}
      />

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
                <td>
                  {(locale === 'ar'
                    ? row.requestedBy?.fullNameAr
                    : row.requestedBy?.fullNameEn) ?? '—'}
                </td>
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
                  {/* Nothing waiting on you and nothing matching your filter
                      are different facts, and only one of them is good news. */}
                  {filtered ? t('noMatch') : t('empty')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
