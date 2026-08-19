'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { TAX_BASES, TAX_TYPES } from '@acms/shared';

export interface TaxRuleRow {
  id: string;
  code: string;
  name: string;
  taxType: string;
  base: string;
  ratePercent: string;
  isRecoverable: boolean;
  country: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  approvalStatus: string;
  rejectionReason: string | null;
  note: string | null;
  inForceHere: boolean;
  createdBy: { fullNameEn: string } | null;
  approvedBy: { fullNameEn: string } | null;
}

/**
 * Tax rules — the same governance as cost rules, and the same two states shown
 * apart: approved is about Finance, in force is about this scope.
 *
 * The base is on the face of the table rather than in a detail view, because a
 * rate without what it is charged on is not a rule anybody can check. Fourteen
 * percent of the selling price and fourteen percent of subcontractor payments
 * are different amounts and different arguments with the tax authority.
 */
export function TaxRuleSettings({
  rules,
  canApprove,
}: {
  rules: TaxRuleRow[];
  canApprove: boolean;
}) {
  const t = useTranslations('taxRules');
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [form, setForm] = useState({
    name: '',
    taxType: 'VAT',
    base: 'SELLING_PRICE',
    ratePercent: '',
    isRecoverable: false,
    country: '',
    effectiveFrom: new Date().toISOString().slice(0, 10),
    note: '',
  });

  async function send(url: string, method: 'POST' | 'DELETE', body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(
          Array.isArray(data.message) ? data.message.join(' • ') : (data.message ?? t('failed')),
        );
        return false;
      }
      router.refresh();
      return true;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <div className="btn-row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0, fontSize: 15 }}>{t('title')}</h2>
        <button type="button" className="btn btn-sm" onClick={() => setOpen((o) => !o)}>
          {open ? t('cancel') : t('propose')}
        </button>
      </div>

      <p className="muted" style={{ marginTop: 6 }}>
        {t('subtitle')}
      </p>

      {open && (
        <form
          className="form-grid"
          style={{ margin: '12px 0' }}
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await send('/api/tax-rules', 'POST', {
              name: form.name,
              taxType: form.taxType,
              base: form.base,
              ratePercent: Number(form.ratePercent),
              isRecoverable: form.isRecoverable,
              country: form.country || undefined,
              effectiveFrom: new Date(form.effectiveFrom).toISOString(),
              note: form.note || undefined,
            });
            if (ok) setOpen(false);
          }}
        >
          <div className="field">
            <label htmlFor="tx-name">{t('name')} *</label>
            <input
              id="tx-name"
              required
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div className="field">
            <label htmlFor="tx-type">{t('type')} *</label>
            <select
              id="tx-type"
              value={form.taxType}
              onChange={(e) => setForm((f) => ({ ...f, taxType: e.target.value }))}
            >
              {TAX_TYPES.map((x) => (
                <option key={x} value={x}>
                  {t(x)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="tx-base">{t('base')} *</label>
            <select
              id="tx-base"
              value={form.base}
              onChange={(e) => setForm((f) => ({ ...f, base: e.target.value }))}
            >
              {TAX_BASES.map((x) => (
                <option key={x} value={x}>
                  {t(x)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="tx-rate">{t('rate')} *</label>
            <input
              id="tx-rate"
              type="number"
              step="0.01"
              min={0}
              max={100}
              required
              value={form.ratePercent}
              onChange={(e) => setForm((f) => ({ ...f, ratePercent: e.target.value }))}
            />
          </div>
          <div className="field">
            <label htmlFor="tx-from">{t('from')} *</label>
            <input
              id="tx-from"
              type="date"
              required
              value={form.effectiveFrom}
              onChange={(e) => setForm((f) => ({ ...f, effectiveFrom: e.target.value }))}
            />
          </div>
          <div className="field">
            <label htmlFor="tx-country">{t('country')}</label>
            <input
              id="tx-country"
              maxLength={2}
              placeholder={t('allCountries')}
              value={form.country}
              onChange={(e) => setForm((f) => ({ ...f, country: e.target.value.toUpperCase() }))}
            />
          </div>
          <div className="field wide">
            <label>
              <input
                type="checkbox"
                checked={form.isRecoverable}
                onChange={(e) => setForm((f) => ({ ...f, isRecoverable: e.target.checked }))}
              />{' '}
              {t('recoverable')}
            </label>
            <span className="muted">{t('recoverableHint')}</span>
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {t('save')}
            </button>
            <span className="muted">{t('draftHint')}</span>
          </div>
        </form>
      )}

      {error && <p className="form-error">{error}</p>}

      <table className="data">
        <thead>
          <tr>
            <th>{t('name')}</th>
            <th>{t('type')}</th>
            <th>{t('base')}</th>
            <th>{t('rate')}</th>
            <th>{t('scope')}</th>
            <th>{t('status')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rules.map((r) => (
            <tr key={r.id}>
              <td>
                {r.name}
                <div className="muted" style={{ fontSize: 12 }}>
                  {r.code}
                </div>
              </td>
              <td>{t(r.taxType)}</td>
              <td>{t(r.base)}</td>
              <td>
                {Number(r.ratePercent)}%
                {r.isRecoverable && (
                  <span className="badge" style={{ marginInlineStart: 6 }}>
                    {t('recoverableShort')}
                  </span>
                )}
              </td>
              <td>{r.country ?? t('allCountries')}</td>
              <td>
                {/* Two readings, never merged: Finance approved it, and it
                    applies here. A country rule can replace an approved one. */}
                <span
                  className={`badge ${
                    r.approvalStatus === 'APPROVED'
                      ? 'badge-success'
                      : r.approvalStatus === 'REJECTED'
                        ? 'badge-danger'
                        : 'badge-warning'
                  }`}
                >
                  {t(r.approvalStatus)}
                </span>
                {r.inForceHere && (
                  <span className="badge badge-info" style={{ marginInlineStart: 6 }}>
                    {t('inForce')}
                  </span>
                )}
                {r.rejectionReason && (
                  <div className="muted" style={{ fontSize: 12 }}>
                    {r.rejectionReason}
                  </div>
                )}
              </td>
              <td>
                {canApprove && r.approvalStatus === 'DRAFT' ? (
                  rejecting === r.id ? (
                    <div className="btn-row">
                      <input
                        value={reason}
                        placeholder={t('rejectionReason')}
                        onChange={(e) => setReason(e.target.value)}
                        style={{ minWidth: 180 }}
                      />
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        disabled={busy || !reason.trim()}
                        onClick={async () => {
                          const ok = await send(`/api/tax-rules/${r.id}/decision`, 'POST', {
                            approve: false,
                            rejectionReason: reason,
                          });
                          if (ok) {
                            setRejecting(null);
                            setReason('');
                          }
                        }}
                      >
                        {t('confirmReject')}
                      </button>
                      <button type="button" className="btn btn-sm" onClick={() => setRejecting(null)}>
                        {t('cancel')}
                      </button>
                    </div>
                  ) : (
                    <div className="btn-row">
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        disabled={busy}
                        onClick={() =>
                          send(`/api/tax-rules/${r.id}/decision`, 'POST', { approve: true })
                        }
                      >
                        {t('approve')}
                      </button>
                      <button type="button" className="btn btn-sm" onClick={() => setRejecting(r.id)}>
                        {t('reject')}
                      </button>
                    </div>
                  )
                ) : canApprove ? (
                  <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    disabled={busy}
                    onClick={() => send(`/api/tax-rules/${r.id}`, 'DELETE')}
                  >
                    {t('remove')}
                  </button>
                ) : null}
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
