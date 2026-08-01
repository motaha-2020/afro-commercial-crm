'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

export interface Readiness {
  ready: boolean;
  met: string[];
  missing: string[];
}

export interface SignoffRow {
  id: string;
  party: string;
  isAccepted: boolean | null;
  comment: string | null;
  signedAt: string | null;
  signedBy: { fullNameEn: string } | null;
}

/**
 * The exit gate and the sign-off table on one screen.
 *
 * They belong together because the gate is the answer to the question the
 * sign-off asks. The spec's failure case is a project manager discovering after
 * the fact that the price or the schedule cannot be delivered — so the person
 * about to accept sees, in the same view, exactly which conditions are met and
 * which are not.
 *
 * Refusing costs a reason. Accepting is impossible while anything is missing,
 * and the button says why rather than being mysteriously disabled.
 */
export function HandoverGate({
  handoverId,
  readiness,
  signoffs,
  status,
}: {
  handoverId: string;
  readiness: Readiness;
  signoffs: SignoffRow[];
  status: string;
}) {
  const t = useTranslations('handover');
  const router = useRouter();

  const [party, setParty] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [accepting, setAccepting] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sign() {
    if (!party) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/handovers/${handoverId}/signoff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ party, accept: accepting, comment: comment || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        const detail = Array.isArray(data.missing) ? ` (${data.missing.join(', ')})` : '';
        throw new Error(
          (Array.isArray(data.message) ? data.message.join(' • ') : (data.message ?? t('failed'))) +
            detail,
        );
      }
      setParty(null);
      setComment('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const pending = signoffs.filter((s) => s.isAccepted === null);

  return (
    <>
      <div className="panel">
        <h3 style={{ marginTop: 0, fontSize: 14 }}>{t('gate')}</h3>

        <div className={`readiness ${readiness.ready ? 'ok' : 'not-ok'}`}>
          <strong>{readiness.ready ? t('ready') : t('notReady')}</strong>
          <span>{readiness.ready ? t('readyHint') : t('notReadyHint')}</span>
        </div>

        <table className="data">
          <tbody>
            {readiness.missing.map((r) => (
              <tr key={r}>
                <td style={{ width: 24 }}>✕</td>
                <td>
                  <strong>{t(r)}</strong>
                  <div style={{ color: 'var(--muted)', fontSize: 11 }}>{t(`${r}_hint`)}</div>
                </td>
              </tr>
            ))}
            {readiness.met.map((r) => (
              <tr key={r} style={{ color: 'var(--muted)' }}>
                <td style={{ width: 24 }}>✓</td>
                <td>{t(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <h3 style={{ marginTop: 0, fontSize: 14 }}>{t('signoffs')}</h3>
        <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 0 }}>{t('signoffsHint')}</p>

        {error && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}

        <table className="data">
          <thead>
            <tr>
              <th>{t('party')}</th>
              <th>{t('answer')}</th>
              <th>{t('who')}</th>
              <th>{t('comment')}</th>
            </tr>
          </thead>
          <tbody>
            {signoffs.map((s) => (
              <tr key={s.id}>
                <td>
                  <strong>{t(s.party)}</strong>
                </td>
                <td>
                  {s.isAccepted === null ? (
                    <span className="badge">{t('awaiting')}</span>
                  ) : s.isAccepted ? (
                    <span className="badge badge-ok">{t('accepted')}</span>
                  ) : (
                    <span className="badge badge-warn">{t('refused')}</span>
                  )}
                </td>
                <td>{s.signedBy?.fullNameEn ?? '—'}</td>
                <td>{s.comment ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {status !== 'COMPLETED' && status !== 'REJECTED' && pending.length > 0 && (
          <div className="form-grid" style={{ marginTop: 12 }}>
            <div className="field">
              <label>{t('signAs')}</label>
              <select value={party ?? ''} onChange={(e) => setParty(e.target.value || null)}>
                <option value="">—</option>
                {pending.map((s) => (
                  <option key={s.id} value={s.party}>
                    {t(s.party)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>{t('answer')}</label>
              <select
                value={accepting ? 'accept' : 'refuse'}
                onChange={(e) => setAccepting(e.target.value === 'accept')}
              >
                <option value="accept">{t('accept')}</option>
                <option value="refuse">{t('refuse')}</option>
              </select>
            </div>
            <div className="field wide">
              <label>{accepting ? t('commentOptional') : t('reasonRequired')}</label>
              <textarea
                rows={2}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder={accepting ? '' : t('refusePlaceholder')}
              />
            </div>
            <div className="form-actions">
              <button
                className="btn"
                disabled={busy || !party || (!accepting && !comment.trim())}
                onClick={sign}
              >
                {busy ? t('working') : t('record')}
              </button>
              {accepting && !readiness.ready && (
                <span style={{ color: 'var(--warning)', fontSize: 12 }}>{t('blockedByGate')}</span>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
