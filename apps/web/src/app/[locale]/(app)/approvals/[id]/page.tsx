import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api';
import { getAccessToken } from '@/lib/session';
import { money } from '@/lib/format';
import { ApprovalDecision, type FiredRule } from '@/components/ApprovalDecision';

export const dynamic = 'force-dynamic';

interface ApprovalDetail {
  id: string;
  code: string;
  status: string;
  requestedAt: string;
  recordType: string;
  triggeredBy: {
    facts?: Record<string, number | boolean>;
    fired?: FiredRule[];
    undetermined?: { ruleId: string; reason: string }[];
  } | null;
  policySnapshot: Record<string, number> | null;
  requestedBy: { fullNameEn: string } | null;
  currentStep: { name: string; approverRole: string } | null;
  opportunity: {
    id: string;
    code: string;
    name: string;
    currency: string;
    estimatedValue: string | null;
    country: string;
  } | null;
  actions: {
    id: string;
    decision: string;
    comment: string | null;
    conditions: string | null;
    actionDate: string;
    approver: { fullNameEn: string } | null;
    step: { name: string } | null;
  }[];
}

export default async function ApprovalDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const t = await getTranslations('approvals');
  const token = await getAccessToken();

  let request: ApprovalDetail;
  try {
    request = await apiFetch<ApprovalDetail>(`/approvals/${id}`, { token });
  } catch {
    notFound();
  }

  const facts = request.triggeredBy?.facts ?? {};
  const snapshot = request.policySnapshot ?? {};

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{request.opportunity?.name ?? request.recordType}</h1>
          <p>
            {request.code} • <span className="badge">{t(request.status)}</span>
          </p>
        </div>
      </div>

      <div className="grid cols-2">
        <div className="panel">
          <h3 style={{ marginTop: 0, fontSize: 14 }}>{t('commercialSummary')}</h3>
          <table className="data">
            <tbody>
              <tr>
                <td>{t('value')}</td>
                <td>
                  {facts.opportunityValue !== undefined
                    ? money(Number(facts.opportunityValue), request.opportunity?.currency ?? 'USD')
                    : '—'}
                </td>
              </tr>
              <tr>
                <td>{t('margin')}</td>
                <td>
                  {facts.grossMarginPercent !== undefined
                    ? `${Number(facts.grossMarginPercent).toFixed(2)}%`
                    : t('unknown')}
                </td>
              </tr>
              <tr>
                <td>{t('country')}</td>
                <td>{request.opportunity?.country ?? '—'}</td>
              </tr>
            </tbody>
          </table>

          <h3 style={{ fontSize: 14 }}>{t('limitsAtTheTime')}</h3>
          {/* Snapshotted when the request was raised. Editing a policy later
              must not rewrite what this approver was asked to judge. */}
          {Object.keys(snapshot).length === 0 ? (
            <p className="muted">{t('noLimitsConfigured')}</p>
          ) : (
            <table className="data">
              <tbody>
                {Object.entries(snapshot).map(([key, value]) => (
                  <tr key={key}>
                    <td>{t(key)}</td>
                    <td>{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {request.status === 'PENDING' ? (
          <ApprovalDecision
            requestId={request.id}
            fired={request.triggeredBy?.fired ?? []}
            undetermined={request.triggeredBy?.undetermined ?? []}
          />
        ) : (
          <div className="panel">
            <h3 style={{ marginTop: 0, fontSize: 14 }}>{t('decided')}</h3>
            <p className="muted">{t('alreadyDecided')}</p>
          </div>
        )}
      </div>

      <div className="panel">
        <h3 style={{ marginTop: 0, fontSize: 14 }}>{t('history')}</h3>
        <table className="data">
          <thead>
            <tr>
              <th>{t('when')}</th>
              <th>{t('step')}</th>
              <th>{t('who')}</th>
              <th>{t('decision')}</th>
              <th>{t('comment')}</th>
            </tr>
          </thead>
          <tbody>
            {request.actions.map((a) => (
              <tr key={a.id}>
                <td>{a.actionDate.slice(0, 10)}</td>
                <td>{a.step?.name ?? '—'}</td>
                <td>{a.approver?.fullNameEn ?? '—'}</td>
                <td>
                  <span className="badge">{t(a.decision)}</span>
                </td>
                <td>
                  {a.comment ?? '—'}
                  {a.conditions && (
                    <div style={{ color: 'var(--warning)', fontSize: 11 }}>{a.conditions}</div>
                  )}
                </td>
              </tr>
            ))}
            {request.actions.length === 0 && (
              <tr>
                <td colSpan={5} style={{ color: 'var(--muted)' }}>
                  {t('noActions')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p style={{ marginTop: 16 }}>
        <Link href={`/${locale}/approvals`}>← {t('backToQueue')}</Link>
      </p>
    </>
  );
}
