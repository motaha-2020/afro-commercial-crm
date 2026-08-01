'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

export interface AwardOption {
  id: string;
  code: string;
  type: string;
  customerReference: string | null;
}

export interface ProposalVersionOption {
  id: string;
  label: string;
  sellingPrice: string | null;
}

const TYPES = [
  'LUMP_SUM',
  'UNIT_RATE',
  'COST_PLUS',
  'FRAMEWORK',
  'SUPPLY_ONLY',
  'SUPPLY_AND_INSTALL',
  'SERVICE',
] as const;

/**
 * Recording a contract.
 *
 * The proposal reference is the field that decides whether this contract can
 * ever be checked: deviations are computed against it, and a contract with no
 * proposal behind it can only be read, never compared. So it is asked for
 * first and the form says what is lost by leaving it blank, rather than
 * letting someone discover it when the review button refuses.
 */
export function NewContractForm({
  opportunityId,
  awards,
  proposalVersions,
  currency,
}: {
  opportunityId: string;
  awards: AwardOption[];
  proposalVersions: ProposalVersionOption[];
  currency: string;
}) {
  const t = useTranslations('contract');
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [awardId, setAwardId] = useState('');
  const [proposalVersionId, setProposalVersionId] = useState('');
  const [contractNumber, setContractNumber] = useState('');
  const [type, setType] = useState<string>('LUMP_SUM');
  const [contractValue, setContractValue] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [warrantyMonths, setWarrantyMonths] = useState('');
  const [ldPercent, setLdPercent] = useState('');
  const [liabilityCap, setLiabilityCap] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosen = proposalVersions.find((p) => p.id === proposalVersionId);
  const offered = chosen?.sellingPrice ? Number(chosen.sellingPrice) : null;
  const entered = contractValue === '' ? null : Number(contractValue);
  const differs = offered !== null && entered !== null && Math.abs(offered - entered) > 0.01;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}/contracts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          awardId: awardId || undefined,
          proposalVersionId: proposalVersionId || undefined,
          contractNumber: contractNumber || undefined,
          type,
          contractValue: contractValue ? Number(contractValue) : undefined,
          currency,
          paymentTerms: paymentTerms || undefined,
          startDate: startDate ? new Date(startDate).toISOString() : undefined,
          endDate: endDate ? new Date(endDate).toISOString() : undefined,
          warrantyMonths: warrantyMonths ? Number(warrantyMonths) : undefined,
          ldPercent: ldPercent ? Number(ldPercent) : undefined,
          liabilityCap: liabilityCap ? Number(liabilityCap) : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          Array.isArray(data.message) ? data.message.join(' • ') : (data.message ?? t('failed')),
        );
      }
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button className="btn btn-sm" onClick={() => setOpen(true)}>
        {t('recordContract')}
      </button>
    );
  }

  return (
    <div className="panel" style={{ marginTop: 12 }}>
      <h3>{t('recordContract')}</h3>
      {error && <p className="form-error">{error}</p>}

      <div className="form-grid">
        <div className="field">
          <label>{t('againstProposal')}</label>
          <select
            value={proposalVersionId}
            onChange={(e) => setProposalVersionId(e.target.value)}
          >
            <option value="">{t('noProposal')}</option>
            {proposalVersions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>{t('againstAward')}</label>
          <select value={awardId} onChange={(e) => setAwardId(e.target.value)}>
            <option value="">—</option>
            {awards.map((a) => (
              <option key={a.id} value={a.id}>
                {t(a.type)} — {a.customerReference ?? a.code}
              </option>
            ))}
          </select>
        </div>

        {!proposalVersionId && (
          <div className="readiness not-ok" style={{ gridColumn: '1 / -1' }}>
            <strong>{t('noProposalWarning')}</strong>
            <span>{t('noProposalHint')}</span>
          </div>
        )}

        <div className="field">
          <label>{t('contractNumber')}</label>
          <input value={contractNumber} onChange={(e) => setContractNumber(e.target.value)} />
        </div>

        <div className="field">
          <label>{t('contractType')}</label>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {TYPES.map((v) => (
              <option key={v} value={v}>
                {t(v)}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>
            {t('value')} ({currency})
          </label>
          <input
            type="number"
            value={contractValue}
            onChange={(e) => setContractValue(e.target.value)}
          />
          {/* Said here rather than after saving: this is the difference the
              review will raise, and seeing it now is the point. */}
          {differs && (
            <span style={{ color: 'var(--warning)', fontSize: 11 }}>
              {t('differsFromProposal', { offered: offered!.toLocaleString() })}
            </span>
          )}
        </div>

        <div className="field">
          <label>{t('paymentTerms')}</label>
          <input value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} />
        </div>

        <div className="field">
          <label>{t('startDate')}</label>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>

        <div className="field">
          <label>{t('endDate')}</label>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>

        <div className="field">
          <label>{t('warrantyMonths')}</label>
          <input
            type="number"
            value={warrantyMonths}
            onChange={(e) => setWarrantyMonths(e.target.value)}
          />
        </div>

        <div className="field">
          <label>{t('ldPercent')}</label>
          <input type="number" value={ldPercent} onChange={(e) => setLdPercent(e.target.value)} />
        </div>

        <div className="field">
          <label>{t('liabilityCap')}</label>
          <input
            type="number"
            value={liabilityCap}
            onChange={(e) => setLiabilityCap(e.target.value)}
            placeholder={t('liabilityCapPlaceholder')}
          />
        </div>

        <div className="form-actions">
          <button className="btn btn-primary" disabled={busy} onClick={save}>
            {busy ? t('saving') : t('save')}
          </button>
          <button className="btn btn-ghost" onClick={() => setOpen(false)}>
            {t('cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
