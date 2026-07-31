import { getTranslations } from 'next-intl/server';
import { STAGE_ORDER, type OpportunityStage } from '@acms/shared';
import { apiFetch } from '@/lib/api';
import { getAccessToken } from '@/lib/session';
import { money } from '@/lib/format';

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

export default async function OpportunitiesPage() {
  const t = await getTranslations('opportunities');
  const stageT = await getTranslations('stage');
  const healthT = await getTranslations('health');
  const token = await getAccessToken();

  const { items } = await apiFetch<{ items: OppCard[] }>('/opportunities', { token });

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
      </div>

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
                <div className="opp-card" key={c.id}>
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
                </div>
              ))}
              {cards.length === 0 && (
                <div className="count" style={{ marginTop: 12 }}>
                  {t('emptyColumn')}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
