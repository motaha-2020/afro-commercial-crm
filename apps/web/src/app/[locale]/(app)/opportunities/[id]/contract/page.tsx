import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api';
import { getAccessToken } from '@/lib/session';
import { money } from '@/lib/format';
import { HandoverGate, type Readiness, type SignoffRow } from '@/components/HandoverGate';
import { RecordAwardForm } from '@/components/RecordAwardForm';

export const dynamic = 'force-dynamic';

interface AwardRow {
  id: string;
  code: string;
  type: string;
  awardedAt: string;
  awardedValue: string | null;
  currency: string;
  customerReference: string | null;
  erpCostCode: string | null;
}

interface DeviationRow {
  id: string;
  field: string;
  proposalValue: string | null;
  contractValue: string | null;
  riskLevel: string;
  status: string;
  decisionNote: string | null;
  preparedBy: { fullNameEn: string } | null;
}

interface ContractRow {
  id: string;
  code: string;
  contractNumber: string | null;
  status: string;
  contractValue: string | null;
  currency: string;
  reviewedAt: string | null;
  deviations: DeviationRow[];
}

interface HandoverRow {
  id: string;
  code: string;
  status: string;
  readiness: Readiness;
  signoffs: SignoffRow[];
}

export default async function ContractPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const t = await getTranslations('contract');
  const ht = await getTranslations('handover');
  const token = await getAccessToken();

  const [awards, contracts, handovers, gate] = await Promise.all([
    apiFetch<{ awards: AwardRow[]; strongest: string | null; isBinding: boolean }>(
      `/opportunities/${id}/awards`,
      { token },
    ).catch(() => ({ awards: [] as AwardRow[], strongest: null, isBinding: false })),
    apiFetch<ContractRow[]>(`/opportunities/${id}/contracts`, { token }).catch(
      () => [] as ContractRow[],
    ),
    apiFetch<{ id: string }[]>(`/opportunities/${id}/handovers`, { token }).catch(() => []),
    apiFetch<{ readiness: Readiness; strongestAward: string | null; awardIsBinding: boolean }>(
      `/opportunities/${id}/handover-readiness`,
      { token },
    ).catch(() => null),
  ]);

  const handover = handovers.length
    ? await apiFetch<HandoverRow>(`/handovers/${handovers[0].id}`, { token }).catch(() => null)
    : null;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('title')}</h1>
          <p>{t('subtitle')}</p>
        </div>
      </div>

      <div className="panel">
        <div className="btn-row" style={{ justifyContent: 'space-between' }}>
          <h3>{t('awards')}</h3>
          <RecordAwardForm opportunityId={id} />
        </div>
        {/* The reading that matters is the firmest award, not the latest. */}
        <div className={`readiness ${awards.isBinding ? 'ok' : 'not-ok'}`}>
          <strong>
            {awards.strongest ? t(awards.strongest) : t('noAward')}
          </strong>
          <span>{awards.isBinding ? t('bindingHint') : t('notBindingHint')}</span>
        </div>

        <table className="data">
          <thead>
            <tr>
              <th>{t('reference')}</th>
              <th>{t('type')}</th>
              <th>{t('date')}</th>
              <th>{t('value')}</th>
              <th>{t('erpCode')}</th>
            </tr>
          </thead>
          <tbody>
            {awards.awards.map((a) => (
              <tr key={a.id}>
                <td>{a.customerReference ?? a.code}</td>
                <td>
                  <span className="badge">{t(a.type)}</span>
                </td>
                <td>{a.awardedAt.slice(0, 10)}</td>
                <td>{a.awardedValue ? money(Number(a.awardedValue), a.currency) : '—'}</td>
                <td>{a.erpCostCode ?? <span style={{ color: 'var(--muted)' }}>—</span>}</td>
              </tr>
            ))}
            {awards.awards.length === 0 && (
              <tr>
                <td colSpan={5} style={{ color: 'var(--muted)' }}>
                  {t('noAwards')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {contracts.map((c) => (
        <div className="panel" key={c.id}>
          <h3 style={{ marginTop: 0, fontSize: 14 }}>
            {c.contractNumber ?? c.code} <span className="badge">{t(c.status)}</span>
          </h3>
          <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 0 }}>
            {c.contractValue ? money(Number(c.contractValue), c.currency) : '—'} •{' '}
            {c.reviewedAt ? `${t('reviewedOn')} ${c.reviewedAt.slice(0, 10)}` : t('notReviewed')}
          </p>

          <h4 style={{ fontSize: 13 }}>{t('deviations')}</h4>
          <table className="data">
            <thead>
              <tr>
                <th>{t('field')}</th>
                <th>{t('proposal')}</th>
                <th>{t('contract')}</th>
                <th>{t('risk')}</th>
                <th>{t('status')}</th>
                <th>{t('note')}</th>
              </tr>
            </thead>
            <tbody>
              {c.deviations.map((d) => (
                <tr key={d.id}>
                  <td>{t(d.field)}</td>
                  <td>{d.proposalValue ?? '—'}</td>
                  <td>{d.contractValue ?? '—'}</td>
                  <td>
                    <span
                      className={`badge ${d.riskLevel === 'CRITICAL' || d.riskLevel === 'HIGH' ? 'badge-warn' : ''}`}
                    >
                      {t(d.riskLevel)}
                    </span>
                  </td>
                  <td>{t(d.status)}</td>
                  <td>{d.decisionNote ?? '—'}</td>
                </tr>
              ))}
              {c.deviations.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ color: 'var(--muted)' }}>
                    {c.reviewedAt ? t('noDeviations') : t('reviewToSee')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ))}

      {contracts.length === 0 && (
        <div className="panel">
          <p className="muted">{t('noContracts')}</p>
        </div>
      )}

      {handover ? (
        <HandoverGate
          handoverId={handover.id}
          readiness={handover.readiness}
          signoffs={handover.signoffs}
          status={handover.status}
        />
      ) : (
        gate && (
          <div className="panel">
            <h3 style={{ marginTop: 0, fontSize: 14 }}>{ht('gate')}</h3>
            <div className={`readiness ${gate.readiness.ready ? 'ok' : 'not-ok'}`}>
              <strong>{gate.readiness.ready ? ht('ready') : ht('notReady')}</strong>
              <span>{ht('noHandoverYet')}</span>
            </div>
            <ul style={{ fontSize: 13, paddingInlineStart: 18 }}>
              {gate.readiness.missing.map((m) => (
                <li key={m}>{ht(m)}</li>
              ))}
            </ul>
          </div>
        )
      )}

      <p style={{ marginTop: 16 }}>
        <Link href={`/${locale}/opportunities/${id}`}>← {t('backToOpportunity')}</Link>
      </p>
    </>
  );
}
