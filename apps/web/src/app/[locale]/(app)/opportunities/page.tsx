import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { HEALTH_STATES, STAGE_ORDER, type OpportunityStage } from '@acms/shared';
import { apiFetch } from '@/lib/api';
import { getAccessToken } from '@/lib/session';
import { money } from '@/lib/format';
import { ListFilters } from '@/components/ListFilters';

export const dynamic = 'force-dynamic';

interface OppCard {
  id: string;
  code: string;
  name: string;
  stage: OpportunityStage;
  health: string;
  status: string;
  estimatedValue: string | null;
  currency: string;
  account: { legalName: string };
}

interface AccountOption {
  id: string;
  legalName: string;
}

interface OwnerOption {
  id: string;
  fullNameEn: string;
  fullNameAr: string;
}

// A focused board: the stages a live bid actually moves through day to day.
// The full 13-stage lifecycle still exists in the data; this groups the busy
// middle so the board stays readable.
const BOARD_STAGES: OpportunityStage[] = [
  'LEAD_QUALIFICATION',
  'SCOPE_DISCOVERY',
  'COSTING_SOURCING',
  'MANAGEMENT_APPROVAL',
  'PROPOSAL_SUBMISSION',
  'AWARD_CONTRACTING',
];

export default async function OpportunitiesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const t = await getTranslations('opportunities');
  const stageT = await getTranslations('stage');
  const healthT = await getTranslations('health');
  const token = await getAccessToken();

  const one = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : undefined);
  const filters = {
    search: one('search') ?? '',
    accountId: one('accountId') ?? '',
    stage: one('stage') ?? '',
    health: one('health') ?? '',
    ownerId: one('ownerId') ?? '',
  };

  // Filtering happens in the API. On a board that matters twice over: the
  // columns are built from what comes back, so hiding cards in the page would
  // leave the column totals counting rows nobody can see.
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v) query.set(k, v);

  const [{ items }, accounts, owners] = await Promise.all([
    apiFetch<{ items: OppCard[] }>(
      `/opportunities${query.toString() ? `?${query}` : ''}`,
      { token },
    ),
    apiFetch<{ items: AccountOption[] }>('/accounts?pageSize=100', { token }).catch(
      () => ({ items: [] as AccountOption[] }),
    ),
    // Both option lists are fetched unfiltered on purpose — a dropdown built
    // from the visible cards would drop every other choice once one was made.
    apiFetch<OwnerOption[]>('/opportunities/owners', { token }).catch(
      () => [] as OwnerOption[],
    ),
  ]);

  const filtered = Object.values(filters).some(Boolean);

  const byStage = new Map<string, OppCard[]>();
  for (const stage of BOARD_STAGES) byStage.set(stage, []);
  // Bucket everything: stages outside the board fold into the nearest board
  // column at or below their rank so nothing silently disappears.
  for (const opp of items) {
    if (opp.status !== 'ACTIVE') continue;
    const rank = STAGE_ORDER[opp.stage];
    let target = BOARD_STAGES[0];
    for (const s of BOARD_STAGES) {
      if (STAGE_ORDER[s] <= rank) target = s;
    }
    byStage.get(target)!.push(opp);
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('title')}</h1>
          <p>{t('subtitle')}</p>
        </div>
        <Link className="btn" href={`/${locale}/opportunities/new`}>
          + {t('newOpportunity')}
        </Link>
      </div>

      <ListFilters
        basePath={`/${locale}/opportunities`}
        values={filters}
        fields={[
          {
            kind: 'search',
            name: 'search',
            label: t('search'),
            placeholder: t('searchPlaceholder'),
          },
          {
            kind: 'select',
            name: 'accountId',
            label: t('account'),
            anyLabel: t('allAccounts'),
            options: accounts.items.map((a) => ({ value: a.id, label: a.legalName })),
          },
          {
            // The board's own columns are stages, so filtering to one stage
            // narrows the board to a single column rather than reordering it.
            // The lifecycle is closed: it is picked from, never added to.
            kind: 'select',
            name: 'stage',
            label: t('stage'),
            anyLabel: t('allStages'),
            options: BOARD_STAGES.map((s) => ({ value: s, label: stageT(s) })),
          },
          {
            kind: 'select',
            name: 'health',
            label: t('health'),
            anyLabel: t('allHealth'),
            options: HEALTH_STATES.map((h) => ({ value: h, label: healthT(h) })),
          },
          {
            kind: 'select',
            name: 'ownerId',
            label: t('owner'),
            anyLabel: t('allOwners'),
            options: owners.map((o) => ({
              value: o.id,
              label: locale === 'ar' ? o.fullNameAr : o.fullNameEn,
            })),
          },
        ]}
      />

      <div className="kanban">
        {BOARD_STAGES.map((stage) => {
          const cards = byStage.get(stage)!;
          const total = cards.reduce((s, c) => s + Number(c.estimatedValue ?? 0), 0);
          return (
            <div className="kanban-col" key={stage}>
              <h3>{stageT(stage)}</h3>
              <div className="count">
                {cards.length} • {money(total)}
              </div>
              {cards.map((c) => (
                <Link className="opp-card" key={c.id} href={`/${locale}/opportunities/${c.id}`}>
                  <div className="name">{c.name}</div>
                  <div className="meta">
                    {c.code} • {c.account.legalName}
                  </div>
                  <div style={{ marginTop: 8 }}>
                    <span className={`badge health-${c.health}`}>
                      {healthT(c.health)}
                    </span>
                  </div>
                  <div className="value">{money(c.estimatedValue, c.currency)}</div>
                </Link>
              ))}
              {cards.length === 0 && (
                <div className="count" style={{ marginTop: 12 }}>
                  {/* An empty column and a column emptied by a filter are
                      different facts, and only one of them is a problem. */}
                  {filtered ? t('noMatchColumn') : t('emptyColumn')}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
