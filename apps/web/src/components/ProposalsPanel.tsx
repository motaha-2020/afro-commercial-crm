'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  PROPOSAL_TYPES,
  canSubmitProposalVersion,
  isCommercialProposal,
} from '@acms/shared';
import { money, shortDate } from '@/lib/format';

export interface ProposalVersionRow {
  id: string;
  versionNumber: number;
  type: string;
  status: string;
  sellingPrice: string | null;
  currency: string;
  validUntil: string | null;
  paymentTerms: string | null;
  durationDays: number | null;
  warrantyMonths: number | null;
  submittedAt: string | null;
  submittedTo: string | null;
  submissionMethod: string | null;
  costingVersion: { id: string; versionNumber: number; status: string } | null;
}

export interface ProposalRow {
  id: string;
  code: string;
  title: string;
  createdAt: string;
  versions: ProposalVersionRow[];
}

/** An approved costing version, which is the only kind a price may come from. */
export interface CostingOption {
  id: string;
  label: string;
  totalPrice: string | null;
  currency: string;
}

export interface BidOption {
  id: string;
  label: string;
}

function statusClass(status: string) {
  if (status === 'SUBMITTED') return 'badge-success';
  if (status === 'SUPERSEDED' || status === 'WITHDRAWN') return 'badge-info';
  return '';
}

const EMPTY_VERSION = {
  type: 'INITIAL',
  costingVersionId: '',
  validUntil: '',
  paymentTerms: '',
  durationDays: '',
  warrantyMonths: '',
  ldPercent: '',
  liabilityCap: '',
};

/**
 * The proposals of one opportunity, and the two acts that move them: adding a
 * version and sending it.
 *
 * The screen exists because the API for all of this was complete while the only
 * way to reach it was a REST client — the last step of the commercial cycle was
 * the one step that left the system.
 */
export function ProposalsPanel({
  opportunityId,
  proposals,
  costingOptions,
  bids,
}: {
  opportunityId: string;
  proposals: ProposalRow[];
  costingOptions: CostingOption[];
  bids: BidOption[];
}) {
  const t = useTranslations('proposals');
  const typeT = useTranslations('proposalType');
  const statusT = useTranslations('proposalStatus');
  const router = useRouter();

  const [newOpen, setNewOpen] = useState(false);
  const [newForm, setNewForm] = useState({ title: '', bidId: '' });

  const [versionFor, setVersionFor] = useState<string | null>(null);
  const [version, setVersion] = useState({ ...EMPTY_VERSION });

  const [sendFor, setSendFor] = useState<string | null>(null);
  const [send, setSend] = useState({ submittedTo: '', submissionMethod: '' });

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const costing = costingOptions.find((c) => c.id === version.costingVersionId) ?? null;
  const priced = isCommercialProposal(version.type);

  async function fail(res: Response) {
    const data = await res.json().catch(() => ({}));
    setError(
      Array.isArray(data.message) ? data.message.join(' • ') : (data.message ?? t('failed')),
    );
  }

  async function post(url: string, body: unknown, done: () => void) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) return void (await fail(res));
      done();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function createProposal(e: React.FormEvent) {
    e.preventDefault();
    return post(
      `/api/opportunities/${opportunityId}/proposals`,
      { title: newForm.title, bidId: newForm.bidId || undefined },
      () => {
        setNewForm({ title: '', bidId: '' });
        setNewOpen(false);
      },
    );
  }

  function addVersion(e: React.FormEvent, proposalId: string) {
    e.preventDefault();
    const num = (v: string) => (v === '' ? undefined : Number(v));
    return post(
      `/api/proposals/${proposalId}/versions`,
      {
        type: version.type,
        // The price is never typed. It is whatever the approved costing says,
        // and a field that let the two disagree would only be refused.
        costingVersionId: priced ? version.costingVersionId : undefined,
        sellingPrice: priced && costing?.totalPrice ? Number(costing.totalPrice) : undefined,
        currency: priced && costing ? costing.currency : undefined,
        validUntil: version.validUntil || undefined,
        paymentTerms: version.paymentTerms || undefined,
        durationDays: num(version.durationDays),
        warrantyMonths: num(version.warrantyMonths),
        ldPercent: num(version.ldPercent),
        liabilityCap: num(version.liabilityCap),
      },
      () => {
        setVersion({ ...EMPTY_VERSION });
        setVersionFor(null);
      },
    );
  }

  function submitVersion(e: React.FormEvent, versionId: string) {
    e.preventDefault();
    return post(
      `/api/proposal-versions/${versionId}/submit`,
      {
        submittedTo: send.submittedTo || undefined,
        submissionMethod: send.submissionMethod || undefined,
      },
      () => {
        setSend({ submittedTo: '', submissionMethod: '' });
        setSendFor(null);
      },
    );
  }

  return (
    <>
      <div className="panel">
        <div className="btn-row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, fontSize: 15 }}>{t('title')}</h2>
          <button type="button" className="btn btn-sm" onClick={() => setNewOpen((o) => !o)}>
            {newOpen ? t('cancel') : t('newProposal')}
          </button>
        </div>

        {newOpen && (
          <form className="form-grid" onSubmit={createProposal} style={{ margin: '14px 0' }}>
            <div className="field wide">
              <label htmlFor="prp-title">{t('proposalTitle')} *</label>
              <input
                id="prp-title"
                required
                maxLength={200}
                value={newForm.title}
                onChange={(e) => setNewForm((f) => ({ ...f, title: e.target.value }))}
              />
            </div>

            {bids.length > 0 && (
              <div className="field">
                <label htmlFor="prp-bid">{t('againstBid')}</label>
                <select
                  id="prp-bid"
                  value={newForm.bidId}
                  onChange={(e) => setNewForm((f) => ({ ...f, bidId: e.target.value }))}
                >
                  <option value="">{t('noBid')}</option>
                  {bids.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="form-actions">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={busy || newForm.title.trim().length === 0}
              >
                {busy ? t('saving') : t('save')}
              </button>
            </div>
          </form>
        )}

        {error && <p className="form-error">{error}</p>}

        {proposals.length === 0 && <p className="muted">{t('empty')}</p>}
      </div>

      {proposals.map((p) => (
        <div className="panel" key={p.id}>
          <div className="btn-row" style={{ justifyContent: 'space-between' }}>
            <h3 style={{ margin: 0, fontSize: 14 }}>
              {p.title} <span className="badge">{p.code}</span>
            </h3>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                setVersionFor(versionFor === p.id ? null : p.id);
                setVersion({ ...EMPTY_VERSION });
              }}
            >
              {versionFor === p.id ? t('cancel') : t('addVersion')}
            </button>
          </div>

          {versionFor === p.id && (
            <form className="form-grid" onSubmit={(e) => addVersion(e, p.id)} style={{ margin: '14px 0' }}>
              <div className="field">
                <label htmlFor="pv-type">{t('type')} *</label>
                <select
                  id="pv-type"
                  value={version.type}
                  onChange={(e) => setVersion((v) => ({ ...v, type: e.target.value }))}
                >
                  {PROPOSAL_TYPES.map((code) => (
                    <option key={code} value={code}>
                      {typeT(code)}
                    </option>
                  ))}
                </select>
              </div>

              {/* Everything but a purely technical proposal quotes a number, and
                  a number may only come from a costing somebody approved. */}
              {priced && (
                <div className="field">
                  <label htmlFor="pv-costing">{t('costingVersion')} *</label>
                  {costingOptions.length === 0 ? (
                    <p className="muted" style={{ margin: 0 }}>
                      {t('noApprovedCosting')}
                    </p>
                  ) : (
                    <select
                      id="pv-costing"
                      required
                      value={version.costingVersionId}
                      onChange={(e) =>
                        setVersion((v) => ({ ...v, costingVersionId: e.target.value }))
                      }
                    >
                      <option value="">{t('chooseCosting')}</option>
                      {costingOptions.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {priced && (
                <div className="field">
                  <label>{t('sellingPrice')}</label>
                  {/* Read from the costing rather than typed: the API refuses a
                      price that disagrees with it, so a writable box here could
                      only produce a rejection. */}
                  <p style={{ margin: 0, fontWeight: 600 }}>
                    {costing?.totalPrice
                      ? money(Number(costing.totalPrice), costing.currency)
                      : '—'}
                  </p>
                  <span className="muted">{t('priceFromCosting')}</span>
                </div>
              )}

              <div className="field">
                <label htmlFor="pv-valid">{t('validUntil')}</label>
                <input
                  id="pv-valid"
                  type="date"
                  value={version.validUntil}
                  onChange={(e) => setVersion((v) => ({ ...v, validUntil: e.target.value }))}
                />
              </div>

              <div className="field">
                <label htmlFor="pv-terms">{t('paymentTerms')}</label>
                <input
                  id="pv-terms"
                  maxLength={500}
                  value={version.paymentTerms}
                  onChange={(e) => setVersion((v) => ({ ...v, paymentTerms: e.target.value }))}
                />
              </div>

              <div className="field">
                <label htmlFor="pv-duration">{t('durationDays')}</label>
                <input
                  id="pv-duration"
                  type="number"
                  min={0}
                  value={version.durationDays}
                  onChange={(e) => setVersion((v) => ({ ...v, durationDays: e.target.value }))}
                />
              </div>

              <div className="field">
                <label htmlFor="pv-warranty">{t('warrantyMonths')}</label>
                <input
                  id="pv-warranty"
                  type="number"
                  min={0}
                  value={version.warrantyMonths}
                  onChange={(e) => setVersion((v) => ({ ...v, warrantyMonths: e.target.value }))}
                />
              </div>

              <div className="field">
                <label htmlFor="pv-ld">{t('ldPercent')}</label>
                <input
                  id="pv-ld"
                  type="number"
                  min={0}
                  step="0.01"
                  value={version.ldPercent}
                  onChange={(e) => setVersion((v) => ({ ...v, ldPercent: e.target.value }))}
                />
              </div>

              <div className="field">
                <label htmlFor="pv-liability">{t('liabilityCap')}</label>
                <input
                  id="pv-liability"
                  type="number"
                  min={0}
                  step="0.01"
                  value={version.liabilityCap}
                  onChange={(e) => setVersion((v) => ({ ...v, liabilityCap: e.target.value }))}
                />
              </div>

              <div className="form-actions">
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={busy || (priced && !version.costingVersionId)}
                >
                  {busy ? t('saving') : t('save')}
                </button>
                <span className="muted">{t('termsHint')}</span>
              </div>
            </form>
          )}

          <table className="data">
            <thead>
              <tr>
                <th>{t('version')}</th>
                <th>{t('type')}</th>
                <th>{t('price')}</th>
                <th>{t('validUntil')}</th>
                <th>{t('status')}</th>
                <th>{t('sentTo')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {p.versions.map((v) => (
                <tr key={v.id}>
                  <td>v{v.versionNumber}</td>
                  <td>{typeT(v.type)}</td>
                  <td>
                    {v.sellingPrice ? money(Number(v.sellingPrice), v.currency) : '—'}
                    {v.costingVersion && (
                      <span className="muted"> · {t('fromCosting', { n: v.costingVersion.versionNumber })}</span>
                    )}
                  </td>
                  <td>{shortDate(v.validUntil)}</td>
                  <td>
                    <span className={`badge ${statusClass(v.status)}`}>{statusT(v.status)}</span>
                  </td>
                  <td>
                    {v.submittedTo ?? '—'}
                    {v.submittedAt && <span className="muted"> · {shortDate(v.submittedAt)}</span>}
                  </td>
                  <td>
                    {/* Sending is offered only where it can succeed. A sent
                        version is what the customer holds — it is superseded by
                        a revision, never re-sent. */}
                    {!canSubmitProposalVersion(v.status) ? (
                      <span className="muted">{t('sentAlready')}</span>
                    ) : sendFor === v.id ? (
                      <form className="btn-row" onSubmit={(e) => submitVersion(e, v.id)}>
                        <input
                          value={send.submittedTo}
                          placeholder={t('sentToPlaceholder')}
                          maxLength={200}
                          onChange={(e) => setSend((s) => ({ ...s, submittedTo: e.target.value }))}
                          style={{ minWidth: 160 }}
                        />
                        <input
                          value={send.submissionMethod}
                          placeholder={t('methodPlaceholder')}
                          maxLength={120}
                          onChange={(e) =>
                            setSend((s) => ({ ...s, submissionMethod: e.target.value }))
                          }
                          style={{ minWidth: 120 }}
                        />
                        <button type="submit" className="btn btn-sm btn-primary" disabled={busy}>
                          {t('confirmSend')}
                        </button>
                        <button type="button" className="btn btn-sm" onClick={() => setSendFor(null)}>
                          {t('cancel')}
                        </button>
                      </form>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => {
                          setSendFor(v.id);
                          setSend({ submittedTo: '', submissionMethod: '' });
                        }}
                      >
                        {t('send')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {p.versions.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ color: 'var(--muted)' }}>
                    {t('noVersions')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ))}
    </>
  );
}
