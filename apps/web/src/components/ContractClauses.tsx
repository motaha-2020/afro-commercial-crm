'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  CONTRACT_CLAUSE_TYPES,
  RISK_LEVELS,
  clauseNeedsMitigation,
  type RiskLevel,
} from '@acms/shared';

export interface ClauseRow {
  id: string;
  clauseType: string;
  clauseText: string;
  riskLevel: string;
  owner: string | null;
  mitigation: string | null;
  isApproved: boolean;
}

function riskClass(risk: string) {
  if (risk === 'CRITICAL') return 'badge-danger';
  if (risk === 'HIGH') return 'badge-warning';
  if (risk === 'MEDIUM') return 'badge-info';
  return 'badge-success';
}

/**
 * The clause register for one contract.
 *
 * Deliberately not the deviations table beside it: a deviation is a difference
 * from what we offered, while a clause can be an unwelcome term that was in the
 * tender from the first day and differs from nothing at all.
 */
export function ContractClauses({
  contractId,
  clauses,
  unapprovedHighRisk,
}: {
  contractId: string;
  clauses: ClauseRow[];
  unapprovedHighRisk: number;
}) {
  const t = useTranslations('clauses');
  const typeT = useTranslations('clauseType');
  const riskT = useTranslations('riskLevel');
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    clauseType: CONTRACT_CLAUSE_TYPES[0] as string,
    clauseText: '',
    riskLevel: 'MEDIUM' as string,
    owner: '',
    mitigation: '',
  });
  const [approving, setApproving] = useState<string | null>(null);
  const [approvalNote, setApprovalNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function set(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function fail(res: Response) {
    const data = await res.json().catch(() => ({}));
    setError(
      Array.isArray(data.message) ? data.message.join(' • ') : (data.message ?? t('failed')),
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/contracts/${contractId}/clauses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clauseType: form.clauseType,
          clauseText: form.clauseText,
          riskLevel: form.riskLevel,
          owner: form.owner || undefined,
          mitigation: form.mitigation || undefined,
        }),
      });
      if (!res.ok) return void (await fail(res));
      setForm({
        clauseType: CONTRACT_CLAUSE_TYPES[0],
        clauseText: '',
        riskLevel: 'MEDIUM',
        owner: '',
        mitigation: '',
      });
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function approve(clause: ClauseRow) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/clauses/${clause.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mitigation: approvalNote || undefined }),
      });
      if (!res.ok) return void (await fail(res));
      setApproving(null);
      setApprovalNote('');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setError(null);
    const res = await fetch(`/api/clauses/${id}`, { method: 'DELETE' });
    if (!res.ok) return void (await fail(res));
    router.refresh();
  }

  return (
    <div className="panel">
      <div className="btn-row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0, fontSize: 15 }}>{t('title')}</h2>
        <button type="button" className="btn btn-sm" onClick={() => setOpen((o) => !o)}>
          {open ? t('cancel') : t('add')}
        </button>
      </div>

      {unapprovedHighRisk > 0 && (
        <div className="readiness not-ok" style={{ marginTop: 12 }}>
          {t('outstanding', { count: unapprovedHighRisk })}
        </div>
      )}

      {open && (
        <form className="form-grid" onSubmit={submit} style={{ margin: '14px 0' }}>
          <div className="field">
            <label htmlFor="cl-type">{t('type')} *</label>
            <select
              id="cl-type"
              value={form.clauseType}
              onChange={(e) => set('clauseType', e.target.value)}
            >
              {CONTRACT_CLAUSE_TYPES.map((code) => (
                <option key={code} value={code}>
                  {typeT(code)}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="cl-risk">{t('risk')} *</label>
            <select
              id="cl-risk"
              value={form.riskLevel}
              onChange={(e) => set('riskLevel', e.target.value)}
            >
              {RISK_LEVELS.map((code) => (
                <option key={code} value={code}>
                  {riskT(code)}
                </option>
              ))}
            </select>
          </div>

          <div className="field wide">
            <label htmlFor="cl-text">{t('text')} *</label>
            <textarea
              id="cl-text"
              required
              rows={3}
              minLength={2}
              value={form.clauseText}
              onChange={(e) => set('clauseText', e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="cl-owner">{t('owner')}</label>
            <input
              id="cl-owner"
              value={form.owner}
              onChange={(e) => set('owner', e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="cl-mit">
              {t('mitigation')}
              {/* Required above medium, and said here rather than discovered at
                  sign-off. */}
              {clauseNeedsMitigation(form.riskLevel as RiskLevel) ? ' *' : ''}
            </label>
            <input
              id="cl-mit"
              value={form.mitigation}
              onChange={(e) => set('mitigation', e.target.value)}
            />
          </div>

          <div className="form-actions">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={busy || form.clauseText.trim().length < 2}
            >
              {busy ? t('saving') : t('save')}
            </button>
            <span className="muted">{t('neverPreApprovedHint')}</span>
          </div>
        </form>
      )}

      {error && <p className="form-error">{error}</p>}

      <table className="data">
        <thead>
          <tr>
            <th>{t('type')}</th>
            <th>{t('risk')}</th>
            <th>{t('text')}</th>
            <th>{t('owner')}</th>
            <th>{t('mitigation')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {clauses.map((c) => (
            <tr key={c.id}>
              <td>{typeT(c.clauseType)}</td>
              <td>
                <span className={`badge ${riskClass(c.riskLevel)}`}>
                  {riskT(c.riskLevel)}
                </span>
              </td>
              <td style={{ maxWidth: 380 }}>{c.clauseText}</td>
              <td>{c.owner ?? '—'}</td>
              <td>{c.mitigation ?? '—'}</td>
              <td>
                {c.isApproved ? (
                  <span className="badge badge-success">{t('approved')}</span>
                ) : approving === c.id ? (
                  <div className="btn-row">
                    <input
                      value={approvalNote}
                      placeholder={t('mitigationPlaceholder')}
                      onChange={(e) => setApprovalNote(e.target.value)}
                      style={{ minWidth: 200 }}
                    />
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      disabled={
                        busy ||
                        (clauseNeedsMitigation(c.riskLevel as RiskLevel) &&
                          !approvalNote.trim() &&
                          !c.mitigation)
                      }
                      onClick={() => approve(c)}
                    >
                      {t('confirmApprove')}
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => setApproving(null)}
                    >
                      {t('cancel')}
                    </button>
                  </div>
                ) : (
                  <div className="btn-row">
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => {
                        setApproving(c.id);
                        setApprovalNote(c.mitigation ?? '');
                      }}
                    >
                      {t('approve')}
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      onClick={() => remove(c.id)}
                    >
                      {t('remove')}
                    </button>
                  </div>
                )}
              </td>
            </tr>
          ))}
          {clauses.length === 0 && (
            <tr>
              <td colSpan={6} style={{ color: 'var(--muted)' }}>
                {t('empty')}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
