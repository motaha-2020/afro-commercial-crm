'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

export interface CostRuleRow {
  id: string;
  code: string;
  name: string;
  category: string;
  method: string;
  value: string;
  country: string | null;
  /** Present only on a rule written for one bid — the narrowest scope there is. */
  opportunity: { id: string; code: string; name: string } | null;
  effectiveFrom: string;
  approvalStatus: string;
  rejectionReason: string | null;
  inForceHere: boolean;
  note: string | null;
  approvedBy: { fullNameEn: string } | null;
}

const CATEGORIES = ['G_AND_A', 'OVERHEAD', 'FINANCING', 'RISK_PROVISION', 'INSURANCE'] as const;
const METHODS = [
  'PERCENT_OF_DIRECT_COST',
  'PERCENT_OF_REVENUE',
  'FIXED_AMOUNT',
  'MONTHLY_RATE',
] as const;

/**
 * G&A and overhead rules.
 *
 * Two states are shown separately because they mean different things and get
 * confused constantly: a rule can be approved and still not apply here,
 * because a narrower rule for this country replaces it. "Approved" is about
 * Finance; "in force" is about this scope.
 *
 * A draft is shown in the list rather than hidden until approved, so the person
 * who proposed a rate can see it is waiting on somebody — and so an approver
 * has something to find.
 */
export function CostRuleSettings({
  rules,
  canApprove,
}: {
  rules: CostRuleRow[];
  canApprove: boolean;
}) {
  const t = useTranslations('costRules');
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: '',
    category: 'G_AND_A' as string,
    method: 'PERCENT_OF_DIRECT_COST' as string,
    value: '',
    country: '',
    opportunityCode: '',
    note: '',
  });
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPercent =
    form.method === 'PERCENT_OF_DIRECT_COST' || form.method === 'PERCENT_OF_REVENUE';

  async function send(url: string, body: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          Array.isArray(data.message) ? data.message.join(' • ') : (data.message ?? t('failed')),
        );
      }
      router.refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <div className="btn-row" style={{ justifyContent: 'space-between' }}>
        <h2>{t('title')}</h2>
        <button className="btn btn-sm" onClick={() => setOpen((o) => !o)}>
          {open ? t('cancel') : t('propose')}
        </button>
      </div>
      <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 0 }}>{t('hint')}</p>

      {error && <p className="form-error">{error}</p>}

      {open && (
        <div className="form-grid" style={{ marginBottom: 14 }}>
          <div className="field">
            <label>{t('name')}</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className="field">
            <label>{t('category')}</label>
            <select
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(c)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>{t('method')}</label>
            <select
              value={form.method}
              onChange={(e) => setForm({ ...form, method: e.target.value })}
            >
              {METHODS.map((m) => (
                <option key={m} value={m}>
                  {t(m)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>{isPercent ? t('percent') : t('amount')}</label>
            <input
              type="number"
              value={form.value}
              onChange={(e) => setForm({ ...form, value: e.target.value })}
            />
          </div>
          <div className="field">
            <label>{t('opportunityCode')}</label>
            <input
              value={form.opportunityCode}
              onChange={(e) => setForm({ ...form, opportunityCode: e.target.value })}
              placeholder={t('opportunityPlaceholder')}
            />
            <p className="field-hint">{t('opportunityHint')}</p>
          </div>

          <div className="field">
            <label>{t('country')}</label>
            <input
              value={form.country}
              onChange={(e) => setForm({ ...form, country: e.target.value })}
              placeholder={t('countryPlaceholder')}
              maxLength={2}
            />
          </div>
          <div className="field wide">
            <label>{t('note')}</label>
            <input
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              placeholder={t('notePlaceholder')}
            />
          </div>
          <div className="form-actions">
            <button
              className="btn btn-primary"
              disabled={busy || form.name.trim().length < 2 || form.value === ''}
              onClick={async () => {
                const ok = await send('/api/cost-rules', {
                  ...form,
                  value: Number(form.value),
                  country: form.country || undefined,
                  opportunityCode: form.opportunityCode.trim() || undefined,
                  note: form.note || undefined,
                });
                if (ok) {
                  setOpen(false);
                  setForm({ ...form, name: '', value: '', note: '' });
                }
              }}
            >
              {busy ? t('saving') : t('proposeRule')}
            </button>
            {/* Said before the click, not after: whoever types a rate is not
                the person who makes it real. */}
            <span style={{ color: 'var(--muted)', fontSize: 12 }}>{t('willBeDraft')}</span>
          </div>
        </div>
      )}

      <table className="data">
        <thead>
          <tr>
            <th>{t('rule')}</th>
            <th>{t('category')}</th>
            <th>{t('method')}</th>
            <th>{t('value')}</th>
            <th>{t('scope')}</th>
            <th>{t('status')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rules.map((r) => (
            <tr key={r.id}>
              <td>
                <strong>{r.name}</strong>
                {r.note && (
                  <div style={{ color: 'var(--muted)', fontSize: 11 }}>{r.note}</div>
                )}
              </td>
              <td>{t(r.category)}</td>
              <td style={{ fontSize: 12 }}>{t(r.method)}</td>
              <td>{Number(r.value)}</td>
              {/* The narrowest scope the rule carries. An opportunity rule
                  names the bid, because "Group" beside a rate that applies to
                  one tender would read as applying to all of them. */}
              <td>
                {r.opportunity ? (
                  <span title={r.opportunity.name} className="ai-code">
                    {r.opportunity.code}
                  </span>
                ) : (
                  (r.country ?? t('group'))
                )}
              </td>
              <td>
                <span
                  className={`badge ${r.approvalStatus === 'APPROVED' ? 'badge-ok' : r.approvalStatus === 'REJECTED' ? 'badge-danger' : 'badge-warn'}`}
                >
                  {t(r.approvalStatus)}
                </span>
                {/* Approved and applying are different facts: a narrower rule
                    for this country can replace this one. */}
                {r.approvalStatus === 'APPROVED' && (
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                    {r.inForceHere ? t('inForce') : t('overriddenHere')}
                  </div>
                )}
                {r.rejectionReason && (
                  <div style={{ fontSize: 11, color: 'var(--danger)' }}>{r.rejectionReason}</div>
                )}
              </td>
              <td>
                {canApprove && r.approvalStatus === 'DRAFT' && (
                  <div className="btn-row">
                    <button
                      className="btn btn-sm"
                      disabled={busy}
                      onClick={() => send(`/api/cost-rules/${r.id}/decision`, { approve: true })}
                    >
                      {t('approve')}
                    </button>
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={() => setRejecting(rejecting === r.id ? null : r.id)}
                    >
                      {t('reject')}
                    </button>
                  </div>
                )}
                {rejecting === r.id && (
                  <div className="btn-row" style={{ marginTop: 6 }}>
                    <input
                      autoFocus
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder={t('reasonPlaceholder')}
                      style={{ padding: '4px 6px' }}
                    />
                    <button
                      className="btn btn-sm btn-danger"
                      disabled={busy || !reason.trim()}
                      onClick={async () => {
                        const ok = await send(`/api/cost-rules/${r.id}/decision`, {
                          approve: false,
                          reason,
                        });
                        if (ok) {
                          setRejecting(null);
                          setReason('');
                        }
                      }}
                    >
                      {t('confirmReject')}
                    </button>
                  </div>
                )}
              </td>
            </tr>
          ))}
          {rules.length === 0 && (
            <tr>
              <td colSpan={7} style={{ color: 'var(--muted)' }}>
                {t('empty')}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
