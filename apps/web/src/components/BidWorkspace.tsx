'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

export interface RequirementRow {
  id: string;
  type: string;
  description: string;
  mandatory: boolean;
  dueDate: string | null;
  status: string;
}

export interface BidRow {
  id: string;
  code: string;
  tenderNumber: string | null;
  type: string;
  status: string;
  issueDate: string | null;
  submissionDeadline: string | null;
  clarificationDeadline: string | null;
  bidBondRequired: boolean;
  bidBondAmount: string | null;
  bidBondCurrency: string | null;
  submissionMethod: string | null;
  portalReference: string | null;
  notes: string | null;
  requirements: RequirementRow[];
  checklist: {
    total: number;
    complete: number;
    mandatoryTotal: number;
    mandatoryComplete: number;
    mandatoryOutstanding: number;
  };
}

const BID_TYPES = [
  'PUBLIC_TENDER', 'PRIVATE_TENDER', 'RFQ', 'RFP', 'DIRECT_NEGOTIATION',
  'FRAMEWORK_CALL_OFF', 'RENEWAL', 'CHANGE_REQUEST',
] as const;
const BID_STATUSES = [
  'IDENTIFIED', 'PREPARING', 'SUBMITTED', 'CLARIFICATION', 'AWARDED', 'LOST', 'WITHDRAWN', 'CANCELLED',
] as const;
const SUBMISSION_METHODS = ['PORTAL', 'EMAIL', 'HAND_DELIVERY', 'COURIER'] as const;
const REQUIREMENT_TYPES = ['TECHNICAL', 'COMMERCIAL', 'LEGAL', 'FINANCIAL', 'HSE', 'ADMINISTRATIVE'] as const;
const COMPLETION_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'READY', 'SUBMITTED', 'WAIVED'] as const;

const EMPTY_BID_FORM = {
  type: 'RFQ' as string,
  tenderNumber: '',
  issueDate: '',
  submissionDeadline: '',
  clarificationDeadline: '',
  bidBondRequired: false,
  bidBondAmount: '',
  bidBondCurrency: '',
  submissionMethod: '',
  portalReference: '',
  notes: '',
};

export function BidWorkspace({ opportunityId, bids }: { opportunityId: string; bids: BidRow[] }) {
  const t = useTranslations('bidWorkspace');
  const router = useRouter();

  const [selectedBidId, setSelectedBidId] = useState<string | null>(bids[0]?.id ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [bidFormOpen, setBidFormOpen] = useState(false);
  const [bidForm, setBidForm] = useState(EMPTY_BID_FORM);

  const [reqFormOpen, setReqFormOpen] = useState(false);
  const [reqForm, setReqForm] = useState({
    description: '', type: 'ADMINISTRATIVE', mandatory: true, dueDate: '',
  });

  const selectedBid = bids.find((b) => b.id === selectedBidId) ?? null;

  async function send(path: string, method: 'POST' | 'PATCH' | 'DELETE', payload?: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: payload === undefined ? undefined : JSON.stringify(payload),
      });
      const data = res.status === 204 ? {} : await res.json();
      if (!res.ok) {
        throw new Error(
          Array.isArray(data.message) ? data.message.join(' • ') : (data.message ?? t('failed')),
        );
      }
      router.refresh();
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function createBid(e: React.FormEvent) {
    e.preventDefault();
    const result = await send(`/api/opportunities/${opportunityId}/bids`, 'POST', {
      type: bidForm.type,
      tenderNumber: bidForm.tenderNumber || undefined,
      issueDate: bidForm.issueDate ? new Date(bidForm.issueDate).toISOString() : undefined,
      submissionDeadline: bidForm.submissionDeadline
        ? new Date(bidForm.submissionDeadline).toISOString()
        : undefined,
      clarificationDeadline: bidForm.clarificationDeadline
        ? new Date(bidForm.clarificationDeadline).toISOString()
        : undefined,
      bidBondRequired: bidForm.bidBondRequired,
      bidBondAmount: bidForm.bidBondAmount ? Number(bidForm.bidBondAmount) : undefined,
      bidBondCurrency: bidForm.bidBondCurrency || undefined,
      submissionMethod: bidForm.submissionMethod || undefined,
      portalReference: bidForm.portalReference || undefined,
      notes: bidForm.notes || undefined,
    });
    if (result) {
      setBidForm(EMPTY_BID_FORM);
      setBidFormOpen(false);
      setSelectedBidId(result.id);
    }
  }

  async function updateBidStatus(id: string, status: string) {
    await send(`/api/bids/${id}`, 'PATCH', { status });
  }

  async function deleteBid(id: string) {
    await send(`/api/bids/${id}`, 'DELETE');
    if (selectedBidId === id) setSelectedBidId(null);
  }

  async function createRequirement(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedBidId) return;
    const result = await send(`/api/bids/${selectedBidId}/requirements`, 'POST', {
      description: reqForm.description,
      type: reqForm.type,
      mandatory: reqForm.mandatory,
      dueDate: reqForm.dueDate ? new Date(reqForm.dueDate).toISOString() : undefined,
    });
    if (result) {
      setReqForm({ description: '', type: 'ADMINISTRATIVE', mandatory: true, dueDate: '' });
      setReqFormOpen(false);
    }
  }

  async function updateRequirementStatus(id: string, status: string) {
    await send(`/api/bid-requirements/${id}`, 'PATCH', { status });
  }

  async function deleteRequirement(id: string) {
    await send(`/api/bid-requirements/${id}`, 'DELETE');
  }

  return (
    <>
      {error && <p className="form-error">{error}</p>}

      <div className="panel">
        <div className="btn-row" style={{ justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>{t('bids')}</h3>
          <button type="button" className="btn btn-sm" onClick={() => setBidFormOpen((o) => !o)}>
            {bidFormOpen ? t('cancel') : t('registerBid')}
          </button>
        </div>

        {bidFormOpen && (
          <form className="form-grid" onSubmit={createBid} style={{ margin: '12px 0' }}>
            <div className="field">
              <label htmlFor="bidType">{t('type')} *</label>
              <select
                id="bidType"
                value={bidForm.type}
                onChange={(e) => setBidForm((f) => ({ ...f, type: e.target.value }))}
              >
                {BID_TYPES.map((v) => (
                  <option key={v} value={v}>
                    {t(v)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="tenderNumber">{t('tenderNumber')}</label>
              <input
                id="tenderNumber"
                value={bidForm.tenderNumber}
                onChange={(e) => setBidForm((f) => ({ ...f, tenderNumber: e.target.value }))}
              />
            </div>
            <div className="field">
              <label htmlFor="issueDate">{t('issueDate')}</label>
              <input
                id="issueDate"
                type="date"
                value={bidForm.issueDate}
                onChange={(e) => setBidForm((f) => ({ ...f, issueDate: e.target.value }))}
              />
            </div>
            <div className="field">
              <label htmlFor="submissionDeadline">{t('submissionDeadline')}</label>
              <input
                id="submissionDeadline"
                type="date"
                value={bidForm.submissionDeadline}
                onChange={(e) => setBidForm((f) => ({ ...f, submissionDeadline: e.target.value }))}
              />
            </div>
            <div className="field">
              <label htmlFor="clarificationDeadline">{t('clarificationDeadline')}</label>
              <input
                id="clarificationDeadline"
                type="date"
                value={bidForm.clarificationDeadline}
                onChange={(e) =>
                  setBidForm((f) => ({ ...f, clarificationDeadline: e.target.value }))
                }
              />
            </div>
            <div className="field">
              <label htmlFor="submissionMethod">{t('submissionMethod')}</label>
              <select
                id="submissionMethod"
                value={bidForm.submissionMethod}
                onChange={(e) => setBidForm((f) => ({ ...f, submissionMethod: e.target.value }))}
              >
                <option value="">—</option>
                {SUBMISSION_METHODS.map((v) => (
                  <option key={v} value={v}>
                    {t(v)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="bidBondRequired">{t('bidBond')}</label>
              <label className="btn-row" style={{ fontSize: 13 }}>
                <input
                  id="bidBondRequired"
                  type="checkbox"
                  style={{ width: 'auto' }}
                  checked={bidForm.bidBondRequired}
                  onChange={(e) => setBidForm((f) => ({ ...f, bidBondRequired: e.target.checked }))}
                />
                {t('bidBondRequired')}
              </label>
            </div>
            {bidForm.bidBondRequired && (
              <>
                <div className="field">
                  <label htmlFor="bidBondAmount">{t('bidBondAmount')}</label>
                  <input
                    id="bidBondAmount"
                    type="number"
                    min={0}
                    value={bidForm.bidBondAmount}
                    onChange={(e) => setBidForm((f) => ({ ...f, bidBondAmount: e.target.value }))}
                  />
                </div>
                <div className="field">
                  <label htmlFor="bidBondCurrency">{t('bidBondCurrency')}</label>
                  <input
                    id="bidBondCurrency"
                    maxLength={3}
                    value={bidForm.bidBondCurrency}
                    onChange={(e) =>
                      setBidForm((f) => ({ ...f, bidBondCurrency: e.target.value.toUpperCase() }))
                    }
                  />
                </div>
              </>
            )}
            <div className="field wide">
              <label htmlFor="bidNotes">{t('notes')}</label>
              <textarea
                id="bidNotes"
                rows={2}
                value={bidForm.notes}
                onChange={(e) => setBidForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>
            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? t('saving') : t('save')}
              </button>
            </div>
          </form>
        )}

        <table className="data">
          <thead>
            <tr>
              <th>{t('bidCode')}</th>
              <th>{t('tenderNumber')}</th>
              <th>{t('type')}</th>
              <th>{t('bidStatus')}</th>
              <th>{t('deadline')}</th>
              <th>{t('mandatoryChecklist')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {bids.map((b) => (
              <tr
                key={b.id}
                onClick={() => setSelectedBidId(b.id)}
                style={{
                  cursor: 'pointer',
                  background: b.id === selectedBidId ? 'var(--panel-2)' : undefined,
                }}
              >
                <td>{b.code}</td>
                <td>{b.tenderNumber ?? '—'}</td>
                <td>{t(b.type)}</td>
                <td onClick={(e) => e.stopPropagation()}>
                  <select
                    value={b.status}
                    onChange={(e) => updateBidStatus(b.id, e.target.value)}
                    style={{ fontSize: 11, padding: '2px 6px' }}
                  >
                    {BID_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {t(s)}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  {b.submissionDeadline ? b.submissionDeadline.slice(0, 10) : '—'}
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
                <td onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    onClick={() => deleteBid(b.id)}
                  >
                    {t('remove')}
                  </button>
                </td>
              </tr>
            ))}
            {bids.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  {t('noBids')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selectedBid && (
        <div className="panel" style={{ marginTop: 16 }}>
          <div className="btn-row" style={{ justifyContent: 'space-between' }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>
              {t('checklistFor')} {selectedBid.code}
            </h3>
            <button type="button" className="btn btn-sm" onClick={() => setReqFormOpen((o) => !o)}>
              {reqFormOpen ? t('cancel') : t('addRequirement')}
            </button>
          </div>

          {reqFormOpen && (
            <form className="form-grid" onSubmit={createRequirement} style={{ margin: '12px 0' }}>
              <div className="field wide">
                <label htmlFor="reqDescription">{t('requirementDescription')} *</label>
                <input
                  id="reqDescription"
                  required
                  minLength={3}
                  value={reqForm.description}
                  onChange={(e) => setReqForm((f) => ({ ...f, description: e.target.value }))}
                />
              </div>
              <div className="field">
                <label htmlFor="reqType">{t('requirementType')}</label>
                <select
                  id="reqType"
                  value={reqForm.type}
                  onChange={(e) => setReqForm((f) => ({ ...f, type: e.target.value }))}
                >
                  {REQUIREMENT_TYPES.map((v) => (
                    <option key={v} value={v}>
                      {t(v)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="reqDueDate">{t('dueDate')}</label>
                <input
                  id="reqDueDate"
                  type="date"
                  value={reqForm.dueDate}
                  onChange={(e) => setReqForm((f) => ({ ...f, dueDate: e.target.value }))}
                />
              </div>
              <div className="field">
                <label htmlFor="reqMandatory">{t('mandatory')}</label>
                <label className="btn-row" style={{ fontSize: 13 }}>
                  <input
                    id="reqMandatory"
                    type="checkbox"
                    style={{ width: 'auto' }}
                    checked={reqForm.mandatory}
                    onChange={(e) => setReqForm((f) => ({ ...f, mandatory: e.target.checked }))}
                  />
                  {t('mandatoryHint')}
                </label>
              </div>
              <div className="form-actions">
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={busy || reqForm.description.length < 3}
                >
                  {busy ? t('saving') : t('save')}
                </button>
              </div>
            </form>
          )}

          <table className="data">
            <thead>
              <tr>
                <th>{t('requirementDescription')}</th>
                <th>{t('requirementType')}</th>
                <th>{t('mandatory')}</th>
                <th>{t('dueDate')}</th>
                <th>{t('completionStatus')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {selectedBid.requirements.map((r) => (
                <tr key={r.id}>
                  <td>{r.description}</td>
                  <td>{t(r.type)}</td>
                  <td>
                    {r.mandatory ? (
                      <span className="badge badge-warn">{t('mandatory')}</span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>{r.dueDate ? r.dueDate.slice(0, 10) : '—'}</td>
                  <td>
                    <select
                      value={r.status}
                      onChange={(e) => updateRequirementStatus(r.id, e.target.value)}
                      style={{ fontSize: 11, padding: '2px 6px' }}
                    >
                      {COMPLETION_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {t(s)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      onClick={() => deleteRequirement(r.id)}
                    >
                      {t('remove')}
                    </button>
                  </td>
                </tr>
              ))}
              {selectedBid.requirements.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    {t('noRequirements')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
