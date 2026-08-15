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

/**
 * A column's worth, per currency.
 *
 * Adding EGP to USD and printing one number is not a rounding problem, it is a
 * false statement: the board used to sum every card and label the result USD,
 * so a 15M EGP pipeline read as "USD 15.00M". Currencies are not converted here
 * either — a board is not the place to invent an exchange rate — so a column
 * holding two currencies shows two totals, which is the honest answer.
 */
function totalsByCurrency(cards: OppCard[]) {
  const sums = new Map<string, number>();
  for (const c of cards) {
    const n = Number(c.estimatedValue ?? 0);
    if (!n) continue;
    sums.set(c.currency, (sums.get(c.currency) ?? 0) + n);
  }
  return [...sums.entries()].sort((a, b) => b[1] - a[1]);
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
        <div className="head-actions">
          <Link className="btn" href={`/${locale}/opportunities/import`}>
            {t('import')}
          </Link>
          <Link className="btn" href={`/${locale}/opportunities/new`}>
            + {t('newOpportunity')}
          </Link>
        </div>
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
          const totals = totalsByCurrency(cards);
          return (
            <div className="kanban-col" key={stage}>
              {/* Stays put while the cards below it scroll: a column you have
                  scrolled into is a column whose name you can no longer see. */}
              <div className="kanban-col-head">
                <h3>{stageT(stage)}</h3>
                <div className="kanban-col-stats">
                  <span className="kanban-count">{cards.length}</span>
                  <div className="kanban-totals">
                    {totals.map(([currency, sum]) => (
                      <span key={currency}>{money(sum, currency)}</span>
                    ))}
                    {totals.length === 0 && <span className="muted">—</span>}
                  </div>
                </div>
              </div>

              {/* The cards scroll inside the column rather than stretching it.
                  Twenty cards in one stage used to make that column several
                  screens tall while its neighbours stayed short, so the board
                  stopped being comparable at a glance — which is the only
                  thing a board is for. */}
              <div className="kanban-cards">
                {cards.map((c) => (
                  <Link className="opp-card" key={c.id} href={`/${locale}/opportunities/${c.id}`}>
                    <div className="name">{c.name}</div>
                    <div className="meta">
                      {c.code} • {c.account.legalName}
                    </div>
                    <div className="row">
                      <span className={`badge health-${c.health}`}>
                        {healthT(c.health)}
                      </span>
                      <span className="value">{money(c.estimatedValue, c.currency)}</span>
                    </div>
                  </Link>
                ))}
                {cards.length === 0 && (
                  <div className="kanban-empty">
                    {/* An empty column and a column emptied by a filter are
                        different facts, and only one of them is a problem. */}
                    {filtered ? t('noMatchColumn') : t('emptyColumn')}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
