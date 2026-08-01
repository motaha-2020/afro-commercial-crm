'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

export interface PolicyKeyRow {
  key: string;
  value: number | null;
  configured: boolean;
  scope: { level: string; id: string | null } | null;
  effectiveFrom: string | null;
}

/**
 * The settings screen Afro Group asked for.
 *
 * The decision behind it: there is no single right approval limit, because the
 * limits differ by project, by opportunity and by country, and the responsible
 * manager needs room to set them. So this screen — not a deploy — is where the
 * numbers live.
 *
 * Two things it does that a plainer settings form would not:
 *
 * An unset limit is shown as "not set" rather than blank or zero. A screen that
 * quietly omits the margin floor reads as "no concern here"; one that names it
 * as undecided reads as "somebody must decide this", which is the truth until
 * they do.
 *
 * And a reader who cannot change the limits is told so, rather than being given
 * inputs that fail on submit. Who may move a limit is deliberately not who
 * approves deals against it — that separation is SOD_08, and it is the reason
 * the whole matrix means anything.
 */
export function ApprovalPolicySettings({
  keys,
  canEdit,
  scope,
}: {
  keys: PolicyKeyRow[];
  canEdit: boolean;
  scope: { country: string | null; orgUnitId: string | null; opportunityId: string | null };
}) {
  const t = useTranslations('settings');
  const router = useRouter();

  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(key: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/approval-policies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key,
          value: Number(value),
          note: note || undefined,
          country: scope.country ?? undefined,
          orgUnitId: scope.orgUnitId ?? undefined,
          opportunityId: scope.opportunityId ?? undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          Array.isArray(data.message) ? data.message.join(' • ') : (data.message ?? t('failed')),
        );
      }
      setEditing(null);
      setValue('');
      setNote('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const unset = keys.filter((k) => !k.configured);

  return (
    <div className="panel">
      <h2 style={{ marginTop: 0, fontSize: 15 }}>{t('limits')}</h2>
      <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 0 }}>{t('limitsHint')}</p>

      {unset.length > 0 && (
        <div className="readiness not-ok">
          <strong>{t('undecided', { n: unset.length })}</strong>
          <span>{t('undecidedHint')}</span>
        </div>
      )}

      {!canEdit && (
        <div className="readiness not-ok" style={{ marginBottom: 12 }}>
          <strong>{t('readOnly')}</strong>
          <span>{t('readOnlyHint')}</span>
        </div>
      )}

      {error && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}

      <table className="data">
        <thead>
          <tr>
            <th>{t('limit')}</th>
            <th>{t('value')}</th>
            <th>{t('setAt')}</th>
            <th>{t('since')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {keys.map((row) => (
            <tr key={row.key}>
              <td>
                <strong>{t(row.key)}</strong>
                <div style={{ color: 'var(--muted)', fontSize: 11 }}>{t(`${row.key}_hint`)}</div>
              </td>
              <td>
                {editing === row.key ? (
                  <input
                    autoFocus
                    type="number"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    style={{ width: 90, padding: '4px 6px' }}
                  />
                ) : row.configured ? (
                  <strong>{row.value}</strong>
                ) : (
                  <span className="badge badge-warn">{t('notSet')}</span>
                )}
              </td>
              <td>
                {row.scope ? (
                  <span className="badge">{t(row.scope.level)}</span>
                ) : (
                  <span style={{ color: 'var(--muted)' }}>—</span>
                )}
              </td>
              <td style={{ color: 'var(--muted)', fontSize: 12 }}>
                {row.effectiveFrom ? row.effectiveFrom.slice(0, 10) : '—'}
              </td>
              <td>
                {canEdit &&
                  (editing === row.key ? (
                    <span className="btn-row">
                      <input
                        placeholder={t('notePlaceholder')}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        style={{ width: 180, padding: '4px 6px' }}
                      />
                      <button
                        className="btn btn-sm"
                        disabled={busy || value === ''}
                        onClick={() => save(row.key)}
                      >
                        {busy ? t('saving') : t('save')}
                      </button>
                      <button className="btn btn-sm btn-ghost" onClick={() => setEditing(null)}>
                        {t('cancel')}
                      </button>
                    </span>
                  ) : (
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={() => {
                        setEditing(row.key);
                        setValue(row.value === null ? '' : String(row.value));
                        setNote('');
                      }}
                    >
                      {row.configured ? t('change') : t('set')}
                    </button>
                  ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p style={{ color: 'var(--muted)', fontSize: 11, marginBottom: 0 }}>{t('historyHint')}</p>
    </div>
  );
}
