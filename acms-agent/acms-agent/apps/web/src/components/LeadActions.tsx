'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

interface AccountOption {
  id: string;
  legalName: string;
}

/**
 * The lead's lifecycle in one place. Buttons are drawn from the transitions the
 * API says this lead can still make, rather than from a copy of the rules kept
 * here — a second copy would be one release away from disagreeing with the
 * first.
 */
export function LeadActions({
  leadId,
  locale,
  status,
  allowedTransitions,
  accountId,
  accounts,
}: {
  leadId: string;
  locale: string;
  status: string;
  allowedTransitions: string[];
  accountId: string | null;
  accounts: AccountOption[];
}) {
  const t = useTranslations('leads');
  const router = useRouter();

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [disqualifying, setDisqualifying] = useState(false);
  const [reason, setReason] = useState('');
  const [converting, setConverting] = useState(false);
  const [convertAccount, setConvertAccount] = useState(accountId ?? '');

  async function post(path: string, payload: unknown, method: 'PATCH' | 'POST') {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          Array.isArray(data.message) ? data.message.join(' • ') : (data.message ?? t('failed')),
        );
      }
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function move(next: string) {
    const done = await post(`/api/leads/${leadId}/status`, { status: next }, 'PATCH');
    if (done) router.refresh();
  }

  async function disqualify() {
    const done = await post(
      `/api/leads/${leadId}/status`,
      { status: 'DISQUALIFIED', reason },
      'PATCH',
    );
    if (done) {
      setDisqualifying(false);
      setReason('');
      router.refresh();
    }
  }

  async function convert() {
    const done = await post(
      `/api/leads/${leadId}/convert`,
      { accountId: convertAccount || undefined },
      'POST',
    );
    if (done?.opportunity) {
      router.push(`/${locale}/opportunities/${done.opportunity.id}`);
      router.refresh();
    }
  }

  if (allowedTransitions.length === 0) {
    return (
      <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>
        {status === 'CONVERTED' ? t('alreadyConverted') : t('alreadyClosed')}
      </p>
    );
  }

  return (
    <div>
      <div className="btn-row">
        {allowedTransitions
          .filter((s) => s !== 'DISQUALIFIED' && s !== 'CONVERTED')
          .map((s) => (
            <button
              key={s}
              type="button"
              className="btn btn-sm"
              disabled={busy}
              onClick={() => move(s)}
            >
              {t(`moveTo_${s}`)}
            </button>
          ))}

        {allowedTransitions.includes('CONVERTED') && (
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={busy}
            onClick={() => setConverting((c) => !c)}
          >
            {t('convert')}
          </button>
        )}

        {allowedTransitions.includes('DISQUALIFIED') && (
          <button
            type="button"
            className="btn btn-sm btn-danger"
            disabled={busy}
            onClick={() => setDisqualifying((d) => !d)}
          >
            {t('disqualify')}
          </button>
        )}
      </div>

      {converting && (
        <div className="field" style={{ marginTop: 12 }}>
          <label htmlFor="convertAccount">{t('convertAccount')} *</label>
          <select
            id="convertAccount"
            value={convertAccount}
            onChange={(e) => setConvertAccount(e.target.value)}
          >
            <option value="">—</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.legalName}
              </option>
            ))}
          </select>
          <p style={{ color: 'var(--muted)', fontSize: 12, margin: '6px 0' }}>
            {t('convertHint')}
          </p>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy || !convertAccount}
            onClick={convert}
          >
            {busy ? t('working') : t('confirmConvert')}
          </button>
        </div>
      )}

      {disqualifying && (
        <div className="field" style={{ marginTop: 12 }}>
          <label htmlFor="reason">{t('disqualifyReason')} *</label>
          <textarea
            id="reason"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('disqualifyPlaceholder')}
          />
          <button
            type="button"
            className="btn btn-danger btn-sm"
            disabled={busy || reason.trim().length === 0}
            onClick={disqualify}
          >
            {busy ? t('working') : t('confirmDisqualify')}
          </button>
        </div>
      )}

      {error && <p className="form-error">{error}</p>}
    </div>
  );
}
