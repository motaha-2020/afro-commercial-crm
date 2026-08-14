'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

const APPROVAL_STATUSES = [
  'PROSPECT',
  'UNDER_QUALIFICATION',
  'APPROVED',
  'CONDITIONAL',
  'SUSPENDED',
] as const;

const RATING_FIELDS = [
  'technicalRating',
  'commercialRating',
  'financialRating',
  'hseRating',
] as const;

const PARTNER_TYPES = [
  'SUPPLIER',
  'SUBCONTRACTOR',
  'CONSULTANT',
  'LOCAL_PARTNER',
  'LOGISTICS_PROVIDER',
  'EQUIPMENT_RENTAL',
] as const;

export interface PartnerRatings {
  technicalRating: number | null;
  commercialRating: number | null;
  financialRating: number | null;
  hseRating: number | null;
  overallRating: number | null;
  ratedDimensions: number;
  totalDimensions: number;
}

/**
 * Ratings, types, approval and blacklisting in one panel.
 *
 * The four ratings are shown as four inputs and the overall figure is read-only
 * — it is derived by the API and there is nothing to type into it, which is the
 * point: no one can assert an overall standing the four parts do not support.
 */
export function PartnerGovernance({
  partnerId,
  ratings,
  approvalStatus,
  isBlacklisted,
  blacklistReason,
  types,
}: {
  partnerId: string;
  ratings: PartnerRatings;
  approvalStatus: string;
  isBlacklisted: boolean;
  blacklistReason: string | null;
  types: { id: string; type: string }[];
}) {
  const t = useTranslations('partners');
  const router = useRouter();

  const [scores, setScores] = useState<Record<string, string>>(
    Object.fromEntries(
      RATING_FIELDS.map((f) => [f, ratings[f] === null ? '' : String(ratings[f])]),
    ),
  );
  const [status, setStatus] = useState(approvalStatus);
  const [banReason, setBanReason] = useState('');
  const [banning, setBanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveRatings() {
    const payload: Record<string, number> = {};
    for (const f of RATING_FIELDS) {
      if (scores[f] !== '') payload[f] = Number(scores[f]);
    }
    await send(`/api/partners/${partnerId}/ratings`, 'PATCH', payload);
  }

  const activeTypes = new Set(types.map((x) => x.type));

  async function toggleType(type: string) {
    if (activeTypes.has(type)) {
      await send(`/api/partners/${partnerId}/types/${type}`, 'DELETE');
    } else {
      await send(`/api/partners/${partnerId}/types`, 'POST', { type });
    }
  }

  return (
    <div className="panel">
      <h2 style={{ marginTop: 0, fontSize: 15 }}>{t('governance')}</h2>

      <div className="field">
        <label>{t('types')}</label>
        <div className="btn-row">
          {PARTNER_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              disabled={busy}
              className={`btn btn-sm${activeTypes.has(type) ? ' btn-primary' : ''}`}
              onClick={() => toggleType(type)}
            >
              {t(type)}
            </button>
          ))}
        </div>
        <p style={{ color: 'var(--muted)', fontSize: 12, margin: '6px 0 0' }}>
          {t('typesHint')}
        </p>
      </div>

      <div className="form-grid" style={{ marginTop: 12 }}>
        {RATING_FIELDS.map((f) => (
          <div className="field" key={f}>
            <label htmlFor={f}>{t(f)}</label>
            <input
              id={f}
              type="number"
              min={0}
              max={5}
              value={scores[f]}
              onChange={(e) => setScores((s) => ({ ...s, [f]: e.target.value }))}
            />
          </div>
        ))}

        <div className="field">
          <label>{t('overall')}</label>
          <div className="value" style={{ fontSize: 20, fontWeight: 700 }}>
            {ratings.overallRating ?? '—'}
            <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 400 }}>
              {' '}
              {t('ratedOf', {
                rated: ratings.ratedDimensions,
                total: ratings.totalDimensions,
              })}
            </span>
          </div>
        </div>

        <div className="form-actions">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={saveRatings}>
            {busy ? t('saving') : t('saveRatings')}
          </button>
        </div>
      </div>

      <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '16px 0' }} />

      <div className="field">
        <label htmlFor="approvalStatus">{t('approvalStatus')}</label>
        <div className="btn-row">
          <select
            id="approvalStatus"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            style={{ maxWidth: 260 }}
          >
            {APPROVAL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(s)}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy || status === approvalStatus}
            onClick={() => send(`/api/partners/${partnerId}/approval`, 'PATCH', { approvalStatus: status })}
          >
            {t('applyStatus')}
          </button>
        </div>
      </div>

      <div className="field">
        <label>{t('blacklist')}</label>
        {isBlacklisted ? (
          <div>
            <p className="badge badge-danger">{t('blacklisted')}</p>
            {blacklistReason && (
              <p style={{ fontSize: 13 }}>
                <strong>{t('reason')}:</strong> {blacklistReason}
              </p>
            )}
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy}
              onClick={() => send(`/api/partners/${partnerId}/blacklist`, 'PATCH', { isBlacklisted: false })}
            >
              {t('reinstate')}
            </button>
          </div>
        ) : (
          <div>
            <button
              type="button"
              className="btn btn-sm btn-danger"
              disabled={busy}
              onClick={() => setBanning((b) => !b)}
            >
              {t('blacklistAction')}
            </button>
            {banning && (
              <div style={{ marginTop: 8 }}>
                <textarea
                  rows={2}
                  value={banReason}
                  placeholder={t('blacklistPlaceholder')}
                  onChange={(e) => setBanReason(e.target.value)}
                  style={{ width: '100%', padding: 9, borderRadius: 9, border: '1px solid var(--border)' }}
                />
                <button
                  type="button"
                  className="btn btn-sm btn-danger"
                  disabled={busy || banReason.trim().length === 0}
                  onClick={async () => {
                    const ok = await send(`/api/partners/${partnerId}/blacklist`, 'PATCH', {
                      isBlacklisted: true,
                      reason: banReason,
                    });
                    if (ok) {
                      setBanning(false);
                      setBanReason('');
                    }
                  }}
                >
                  {t('confirmBlacklist')}
                </button>
                <p style={{ color: 'var(--muted)', fontSize: 12 }}>{t('blacklistHint')}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {error && <p className="form-error">{error}</p>}
    </div>
  );
}
