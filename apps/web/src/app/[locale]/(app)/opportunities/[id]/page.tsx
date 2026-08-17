import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api';
import { getAccessToken } from '@/lib/session';
import { shortDate } from '@/lib/format';
import { BidScoreForm } from '@/components/BidScoreForm';
import { ActivityTimeline, type ActivityRow } from '@/components/ActivityTimeline';
import { DocumentsPanel, type DocumentRow } from '@/components/DocumentsPanel';
import {
  OpportunityTeamPanel,
  type TeamMemberRow,
} from '@/components/OpportunityTeamPanel';

export const dynamic = 'force-dynamic';

interface ScopeItemNode {
  id: string;
  name: string;
  quantity: string | null;
  unit: string | null;
  responsibility: string;
  exclusion: string | null;
  children: ScopeItemNode[];
}

interface ScopeOverview {
  opportunity: { id: string; code: string; name: string; stage: string };
  packages: {
    id: string;
    name: string;
    category: string;
    inclusion: string;
    status: string;
    items: ScopeItemNode[];
  }[];
  assumptions: {
    id: string;
    description: string;
    category: string;
    confirmationStatus: string;
    impactIfIncorrect: string | null;
  }[];
  clarifications: {
    id: string;
    question: string;
    response: string | null;
    impact: string;
    status: string;
  }[];
  readiness: {
    packages: number;
    items: number;
    unconfirmedAssumptions: number;
    openClarifications: number;
    blockingClarifications: number;
    ready: boolean;
  };
}

interface BidRow {
  id: string;
  code: string;
  tenderNumber: string | null;
  type: string;
  status: string;
  submissionDeadline: string | null;
  checklist: { mandatoryComplete: number; mandatoryTotal: number; mandatoryOutstanding: number };
}

interface CostingScenario {
  id: string;
  name: string;
  type: string;
  currency: string;
  isSelected: boolean;
  versions: {
    id: string;
    versionNumber: number;
    status: string;
    lockedAt: string | null;
    totalCost: string | null;
    totalPrice: string | null;
    marginPercent: string | null;
  }[];
}

interface Opportunity {
  id: string;
  code: string;
  name: string;
  stage: string;
  status: string;
  forecastCategory: string;
  health: string;
  currency: string;
  estimatedValue: string | null;
  receivedDate: string | null;
  expectedCloseDate: string | null;
  nextStep: string | null;
  primaryContact: { id: string; fullName: string; jobTitle: string | null } | null;
  account: { id: string; legalName: string };
}

/** Renders the scope tree at any depth; the spec's "Add Child Item" has no limit. */
function ItemTree({ items, depth = 0 }: { items: ScopeItemNode[]; depth?: number }) {
  return (
    <ul className={depth === 0 ? 'scope-tree' : 'scope-tree nested'}>
      {items.map((item) => (
        <li key={item.id}>
          <span className="scope-item-name">{item.name}</span>
          {item.quantity && (
            <span className="scope-qty">
              {Number(item.quantity)} {item.unit ?? ''}
            </span>
          )}
          <span className={`badge resp-${item.responsibility}`}>{item.responsibility}</span>
          {item.exclusion && <span className="scope-excl">✕ {item.exclusion}</span>}
          {item.children.length > 0 && <ItemTree items={item.children} depth={depth + 1} />}
        </li>
      ))}
    </ul>
  );
}

export default async function OpportunityDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const t = await getTranslations('opportunityDetail');
  const stageT = await getTranslations('stage');
  const healthT = await getTranslations('health');
  const bidT = await getTranslations('bid');
  const token = await getAccessToken();

  // Four independent reads. Any one failing must not blank the page — a bid
  // team still needs the scope when the assessment service is unhappy.
  const [opportunity, scope, bids, assessment, costing, activities, documents, team] = await Promise.all([
    apiFetch<Opportunity>(`/opportunities/${id}`, { token }),
    apiFetch<ScopeOverview>(`/opportunities/${id}/scope`, { token }).catch(() => null),
    apiFetch<BidRow[]>(`/opportunities/${id}/bids`, { token }).catch(() => []),
    apiFetch<{
      latest: null | {
        id: string;
        score: string;
        suggestedDecision: string;
        decision: string | null;
        decisionRationale: string | null;
        ratings: Record<string, number>;
      };
      weights: { factors: { code: string; titleAr: string; titleEn: string; weight: number }[] };
    }>(`/opportunities/${id}/bid-assessment`, { token }).catch(() => null),
    apiFetch<CostingScenario[]>(`/opportunities/${id}/costing`, { token }).catch(
      () => [] as CostingScenario[],
    ),
    apiFetch<{ items: ActivityRow[] }>(
      `/activities?opportunityId=${id}&pageSize=50`,
      { token },
    ).catch(() => ({ items: [] as ActivityRow[] })),
    apiFetch<DocumentRow[]>(
      `/documents?entityType=Opportunity&entityId=${id}`,
      { token },
    ).catch(() => [] as DocumentRow[]),
    apiFetch<{ items: TeamMemberRow[]; hasLead: boolean }>(
      `/opportunities/${id}/team`,
      { token },
    ).catch(() => ({ items: [] as TeamMemberRow[], hasLead: false })),
  ]);

  const readiness = scope?.readiness;

  return (
    <>
      <div className="page-head">
        <div className="page-title">
          {/* The same link as the one at the foot of the page, put where you
              are when you decide to leave. Reaching the bottom of a long record
              first was a tax on changing your mind. It is an icon rather than
              words because it sits beside the title and must not compete with
              it; the label survives for screen readers and on hover. */}
          <Link
            className="page-back"
            href={`/${locale}/opportunities`}
            aria-label={t('backToBoard')}
            title={t('backToBoard')}
          >
            {/* Mirrors itself in Arabic: "back" points the way the reader
                came from, which is the other way in an RTL page. */}
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path
                d="M15 5l-7 7 7 7"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Link>
          <div>
            <h1>{opportunity.name}</h1>
            <p>
              {opportunity.code} •{' '}
              <Link href={`/${locale}/accounts/${opportunity.account.id}`}>
                {opportunity.account.legalName}
              </Link>
            </p>
          </div>
        </div>
        <div className="reading-badges">
          {/* The four independent readings, never collapsed into one status. */}
          <span className="badge badge-primary">{stageT(opportunity.stage)}</span>
          <span className="badge">{opportunity.status}</span>
          <span className="badge">{opportunity.forecastCategory}</span>
          <span className={`badge health-${opportunity.health}`}>
            {healthT(opportunity.health)}
          </span>
        </div>
      </div>

      {/* The four questions asked of every pipeline row in every review: who
          sent it, when it came, when it must be decided, and what happens next.
          Three of the four fields already existed in the record and were shown
          on no screen, which is the same as not having them. */}
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <div className="kpi">
          <div className="label">{t('sentBy')}</div>
          <div className="value" style={{ fontSize: 15 }}>
            {opportunity.primaryContact ? (
              <>
                {opportunity.primaryContact.fullName}
                {opportunity.primaryContact.jobTitle && (
                  <div className="muted" style={{ fontSize: 12 }}>
                    {opportunity.primaryContact.jobTitle}
                  </div>
                )}
              </>
            ) : (
              '—'
            )}
          </div>
        </div>
        <div className="kpi">
          <div className="label">{t('receivedOn')}</div>
          <div className="value" style={{ fontSize: 15 }}>
            {shortDate(opportunity.receivedDate)}
          </div>
        </div>
        <div className="kpi">
          <div className="label">{t('closesOn')}</div>
          <div className="value" style={{ fontSize: 15 }}>
            {shortDate(opportunity.expectedCloseDate)}
          </div>
        </div>
        <div className="kpi">
          <div className="label">{t('nextAction')}</div>
          <div className="value" style={{ fontSize: 15 }}>
            {opportunity.nextStep || '—'}
          </div>
        </div>
      </div>

      <div className="grid cols-2">
        <div className="panel">
          <h3>{t('scope')}</h3>

          {readiness && (
            <div className={`readiness ${readiness.ready ? 'ok' : 'not-ok'}`}>
              <strong>{readiness.ready ? t('scopeReady') : t('scopeNotReady')}</strong>
              <span>
                {readiness.packages} {t('packages')} • {readiness.items} {t('items')} •{' '}
                {readiness.unconfirmedAssumptions} {t('unconfirmed')} •{' '}
                {readiness.openClarifications} {t('openQuestions')}
                {readiness.blockingClarifications > 0 &&
                  ` (${readiness.blockingClarifications} ${t('blocking')})`}
              </span>
            </div>
          )}

          {scope?.packages.map((pkg) => (
            <div className="scope-package" key={pkg.id}>
              <div className="scope-package-head">
                <strong>{pkg.name}</strong>
                <span className="badge">{pkg.category}</span>
                {pkg.inclusion !== 'INCLUDED' && (
                  <span className="badge badge-warn">{pkg.inclusion}</span>
                )}
              </div>
              {pkg.items.length > 0 ? (
                <ItemTree items={pkg.items} />
              ) : (
                <p className="muted">{t('noItems')}</p>
              )}
            </div>
          ))}

          {(!scope || scope.packages.length === 0) && <p className="muted">{t('noScope')}</p>}
        </div>

        <div className="panel">
          <h3>{bidT('title')}</h3>
          {assessment && (
            <BidScoreForm
              opportunityId={id}
              locale={locale}
              factors={assessment.weights.factors}
              latest={
                assessment.latest
                  ? {
                      ...assessment.latest,
                      suggestedDecision: assessment.latest
                        .suggestedDecision as never,
                      decision: assessment.latest.decision as never,
                    }
                  : null
              }
            />
          )}
        </div>
      </div>

      <div className="grid cols-2" style={{ marginTop: 16 }}>
        <div className="panel">
          <h3>{t('assumptions')}</h3>
          <table className="data">
            <tbody>
              {scope?.assumptions.map((a) => (
                <tr key={a.id}>
                  <td>
                    {a.description}
                    {a.impactIfIncorrect && (
                      <div className="muted">{t('ifWrong')}: {a.impactIfIncorrect}</div>
                    )}
                  </td>
                  <td>
                    <span
                      className={`badge ${
                        a.confirmationStatus === 'CONFIRMED' ? 'badge-ok' : 'badge-warn'
                      }`}
                    >
                      {a.confirmationStatus}
                    </span>
                  </td>
                </tr>
              ))}
              {(!scope || scope.assumptions.length === 0) && (
                <tr>
                  <td className="muted">{t('noAssumptions')}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <h3>{t('clarifications')}</h3>
          <table className="data">
            <tbody>
              {scope?.clarifications.map((c) => (
                <tr key={c.id}>
                  <td>
                    {c.question}
                    {c.response && <div className="muted">↳ {c.response}</div>}
                  </td>
                  <td>
                    <span className={`badge impact-${c.impact}`}>{c.impact}</span>
                    <span className="badge">{c.status}</span>
                  </td>
                </tr>
              ))}
              {(!scope || scope.clarifications.length === 0) && (
                <tr>
                  <td className="muted">{t('noClarifications')}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <h3>{t('bids')}</h3>
        <table className="data">
          <thead>
            <tr>
              <th>{t('bidCode')}</th>
              <th>{t('tenderNumber')}</th>
              <th>{t('type')}</th>
              <th>{t('bidStatus')}</th>
              <th>{t('deadline')}</th>
              <th>{t('mandatoryChecklist')}</th>
            </tr>
          </thead>
          <tbody>
            {bids.map((b) => (
              <tr key={b.id}>
                <td>{b.code}</td>
                <td>{b.tenderNumber ?? '—'}</td>
                <td>{b.type}</td>
                <td>{b.status}</td>
                <td>
                  {b.submissionDeadline
                    ? new Date(b.submissionDeadline).toLocaleDateString(locale)
                    : '—'}
                </td>
                <td>
                  <span
                    className={`badge ${
                      b.checklist.mandatoryOutstanding > 0 ? 'badge-warn' : 'badge-ok'
                    }`}
                  >
                    {b.checklist.mandatoryComplete}/{b.checklist.mandatoryTotal}
                  </span>
                </td>
              </tr>
            ))}
            {bids.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  {t('noBids')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <h3>{t('costing')}</h3>
        {costing.length === 0 && <p className="muted">{t('noCosting')}</p>}

        {costing.map((s) => (
          <div className="scope-package" key={s.id}>
            <div className="scope-package-head">
              <strong>{s.name}</strong>
              <span className="badge">{s.type}</span>
              {s.isSelected && <span className="badge badge-ok">{t('selectedScenario')}</span>}
            </div>
            <table className="data">
              <thead>
                <tr>
                  <th>{t('version')}</th>
                  <th>{t('versionStatus')}</th>
                  <th>{t('cost')}</th>
                  <th>{t('price')}</th>
                  {/* Margin is over selling price. Markup is a different number
                      and is never shown under this heading. */}
                  <th>{t('margin')}</th>
                </tr>
              </thead>
              <tbody>
                {s.versions.map((v) => (
                  <tr key={v.id}>
                    <td>
                      v{v.versionNumber}
                      {v.lockedAt && <span title={t('locked')}> 🔒</span>}
                    </td>
                    <td>
                      <span
                        className={`badge ${
                          v.status === 'APPROVED'
                            ? 'badge-ok'
                            : v.status === 'REJECTED'
                              ? 'badge-warn'
                              : ''
                        }`}
                      >
                        {v.status}
                      </span>
                    </td>
                    <td>{v.totalCost ? Number(v.totalCost).toLocaleString() : '—'}</td>
                    <td>{v.totalPrice ? Number(v.totalPrice).toLocaleString() : '—'}</td>
                    <td>{v.marginPercent ? `${Number(v.marginPercent).toFixed(1)}%` : '—'}</td>
                  </tr>
                ))}
                {s.versions.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted">
                      {t('noVersions')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 16 }}>
        <OpportunityTeamPanel
          opportunityId={id}
          members={team.items}
          hasLead={team.hasLead}
        />
      </div>

      <div style={{ marginTop: 16 }}>
        <ActivityTimeline activities={activities.items} anchor={{ opportunityId: id }} />
      </div>

      <div style={{ marginTop: 16 }}>
        <DocumentsPanel entityType="Opportunity" entityId={id} documents={documents} />
      </div>

      <p style={{ marginTop: 16 }} className="btn-row">
        <Link href={`/${locale}/opportunities`}>← {t('backToBoard')}</Link>
        <Link className="btn btn-sm" href={`/${locale}/opportunities/${id}/scope`}>
          {t('scopeBuilder')} →
        </Link>
        <Link className="btn btn-sm" href={`/${locale}/opportunities/${id}/bids`}>
          {t('bidWorkspace')} →
        </Link>
        <Link className="btn btn-sm" href={`/${locale}/opportunities/${id}/costing`}>
          {t('costingBuilder')} →
        </Link>
        <Link className="btn btn-sm" href={`/${locale}/opportunities/${id}/quotations`}>
          {t('supplierComparison')} →
        </Link>
        {/* Between the supplier comparison and the award, because that is
            where it sits in the work: the costing is approved, the offer goes
            out, and only then is there an award to record. */}
        <Link className="btn btn-sm" href={`/${locale}/opportunities/${id}/proposals`}>
          {t('proposals')} →
        </Link>
        <Link className="btn btn-sm" href={`/${locale}/opportunities/${id}/contract`}>
          {t('awardAndContract')} →
        </Link>
      </p>
    </>
  );
}
