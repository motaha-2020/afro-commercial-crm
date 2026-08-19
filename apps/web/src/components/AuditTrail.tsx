'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

export interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  createdAt: string;
  before: unknown;
  after: unknown;
  user: { fullNameEn: string; fullNameAr: string } | null;
}

/**
 * Who touched this record, when, and what changed.
 *
 * Collapsed by default and loaded on demand: the trail is the answer to a
 * question that is only occasionally asked, and putting forty rows above the
 * work would bury the record in its own history. Fetching on open also keeps
 * the page from paying for it on every visit.
 *
 * Read-only, because the trail is append-only in the API too — there is no
 * write endpoint behind this panel to call.
 */
export function AuditTrail({
  entityType,
  entityId,
}: {
  entityType: string;
  entityId: string;
}) {
  const t = useTranslations('audit');
  const actionT = useTranslations('auditAction');

  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next || items) return;

    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/audit/${entityType}/${entityId}`);
      if (!res.ok) {
        // 403 here is not a failure to report loudly: reading who did what is
        // itself restricted, and most users simply do not hold that role.
        setError(res.status === 403 ? t('notPermitted') : t('failed'));
        return;
      }
      const data = await res.json();
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch {
      setError(t('failed'));
    } finally {
      setBusy(false);
    }
  }

  function changedFields(entry: AuditEntry): string {
    const after = entry.after as Record<string, unknown> | null;
    if (!after || typeof after !== 'object') return '—';
    const keys = Object.keys(after);
    // The names, not the values: the values may be exactly what this screen is
    // not allowed to show, and the question being asked here is "what moved".
    return keys.length ? keys.slice(0, 6).join(', ') : '—';
  }

  return (
    <div className="panel">
      <div className="btn-row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0, fontSize: 15 }}>{t('title')}</h2>
        <button type="button" className="btn btn-sm" onClick={toggle}>
          {open ? t('hide') : t('show')}
        </button>
      </div>

      {open && (
        <>
          <p className="muted" style={{ marginTop: 8 }}>
            {t('appendOnly')}
          </p>

          {busy && <p className="muted">{t('loading')}</p>}
          {error && <p className="form-error">{error}</p>}

          {items && (
            <table className="data">
              <thead>
                <tr>
                  <th>{t('when')}</th>
                  <th>{t('who')}</th>
                  <th>{t('action')}</th>
                  <th>{t('changed')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((e) => (
                  <tr key={e.id}>
                    <td>{e.createdAt.slice(0, 16).replace('T', ' ')}</td>
                    <td>{e.user?.fullNameEn ?? t('system')}</td>
                    <td>
                      <span className="badge">{actionT(e.action)}</span>
                    </td>
                    <td style={{ maxWidth: 420 }}>{changedFields(e)}</td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ color: 'var(--muted)' }}>
                      {t('empty')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
