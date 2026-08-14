'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

export interface RefItem {
  id: string;
  code: string;
  labelEn: string;
  labelAr: string;
  labelFr: string;
  sortOrder: number;
  isActive: boolean;
  isSystem: boolean;
}

export interface RefListRow {
  key: string;
  labelEn: string;
  labelAr: string;
  labelFr: string;
  allowsNewItems: boolean;
  lockedReason: string | null;
  items: RefItem[];
}

const EMPTY = { code: '', labelEn: '', labelAr: '', labelFr: '' };

export function RefListsAdmin({
  lists,
  locale,
}: {
  lists: RefListRow[];
  locale: string;
}) {
  const t = useTranslations('refLists');
  const router = useRouter();
  const [openKey, setOpenKey] = useState<string | null>(lists[0]?.key ?? null);
  const [draft, setDraft] = useState(EMPTY);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const listLabel = (l: RefListRow) =>
    locale === 'ar' ? l.labelAr : locale === 'fr' ? l.labelFr : l.labelEn;
  const open = lists.find((l) => l.key === openKey) ?? null;

  async function send(url: string, method: string, body?: unknown) {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        // The API's refusal carries the reason the list is locked; showing our
        // own generic message instead would throw away the only useful part.
        setError(payload.message ?? t('failed'));
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError(t('failed'));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    if (!open) return;
    const ok = await send(`/api/ref-lists/${open.key}/items`, 'POST', {
      ...draft,
      code: draft.code.trim().toUpperCase(),
    });
    if (ok) setDraft(EMPTY);
  }

  const toggle = (item: RefItem) =>
    item.isActive
      ? send(`/api/ref-lists/items/${item.id}`, 'DELETE')
      : send(`/api/ref-lists/items/${item.id}`, 'PATCH', { isActive: true });

  const move = (item: RefItem, delta: number) =>
    send(`/api/ref-lists/items/${item.id}`, 'PATCH', {
      sortOrder: Math.max(0, item.sortOrder + delta),
    });

  const rename = (item: RefItem, field: 'labelEn' | 'labelAr' | 'labelFr', value: string) =>
    value.trim() && value !== item[field]
      ? send(`/api/ref-lists/items/${item.id}`, 'PATCH', { [field]: value.trim() })
      : undefined;

  return (
    <div className="grid cols-2" style={{ alignItems: 'start' }}>
      <div className="panel">
        <h2 style={{ marginTop: 0, fontSize: 15 }}>{t('lists')}</h2>
        <div className="ref-list-nav">
          {lists.map((l) => (
            <button
              key={l.key}
              type="button"
              className={`ref-list-tab${l.key === openKey ? ' active' : ''}`}
              onClick={() => {
                setOpenKey(l.key);
                setDraft(EMPTY);
                setError('');
              }}
            >
              <span>{listLabel(l)}</span>
              <span className="muted">{l.items.filter((i) => i.isActive).length}</span>
              {/* Marked in the index, not only inside: an administrator should
                  see which lists are fixed before clicking into one. */}
              {!l.allowsNewItems && <span className="badge badge-warning">{t('locked')}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="panel">
        {!open ? (
          <p className="muted">{t('pickList')}</p>
        ) : (
          <>
            <h2 style={{ marginTop: 0, fontSize: 15 }}>{listLabel(open)}</h2>

            {!open.allowsNewItems && (
              <div className="readiness not-ok">
                <strong>{t('lockedTitle')}</strong>
                <span>{open.lockedReason ?? t('lockedGeneric')}</span>
              </div>
            )}

            {error && <p className="form-error">{error}</p>}

            <table className="data">
              <thead>
                <tr>
                  <th>{t('code')}</th>
                  <th>{t('labelEn')}</th>
                  <th>{t('labelAr')}</th>
                  <th>{t('labelFr')}</th>
                  <th>{t('state')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {open.items.map((item) => (
                  <tr key={item.id} style={{ opacity: item.isActive ? 1 : 0.5 }}>
                    {/* The code never changes: it is what every record already
                        filed under this value points at. */}
                    <td><code>{item.code}</code></td>
                    {(['labelEn', 'labelAr', 'labelFr'] as const).map((field) => (
                      <td key={field}>
                        <input
                          className="ref-label-input"
                          defaultValue={item[field]}
                          onBlur={(e) => rename(item, field, e.target.value)}
                          disabled={busy}
                          dir={field === 'labelAr' ? 'rtl' : 'ltr'}
                        />
                      </td>
                    ))}
                    <td>
                      <span className={`badge ${item.isActive ? 'badge-success' : 'badge-warning'}`}>
                        {item.isActive ? t('active') : t('inactive')}
                      </span>
                    </td>
                    <td>
                      <div className="btn-row">
                        <button type="button" className="btn btn-sm" disabled={busy} onClick={() => move(item, -15)}>↑</button>
                        <button type="button" className="btn btn-sm" disabled={busy} onClick={() => move(item, 15)}>↓</button>
                        <button type="button" className="btn btn-sm" disabled={busy} onClick={() => toggle(item)}>
                          {item.isActive ? t('deactivate') : t('reactivate')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {open.items.length === 0 && (
                  <tr><td colSpan={6} className="muted">{t('noItems')}</td></tr>
                )}
              </tbody>
            </table>

            {open.allowsNewItems && (
              <div className="ref-add">
                <h3 style={{ fontSize: 13, margin: '14px 0 8px' }}>{t('addValue')}</h3>
                <div className="list-filters" style={{ marginBottom: 8 }}>
                  <input
                    placeholder={t('codePlaceholder')}
                    value={draft.code}
                    onChange={(e) => setDraft({ ...draft, code: e.target.value })}
                  />
                  <input
                    placeholder={t('labelEn')}
                    value={draft.labelEn}
                    onChange={(e) => setDraft({ ...draft, labelEn: e.target.value })}
                  />
                  <input
                    placeholder={t('labelAr')}
                    dir="rtl"
                    value={draft.labelAr}
                    onChange={(e) => setDraft({ ...draft, labelAr: e.target.value })}
                  />
                  <input
                    placeholder={t('labelFr')}
                    value={draft.labelFr}
                    onChange={(e) => setDraft({ ...draft, labelFr: e.target.value })}
                  />
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={
                      busy || !draft.code || !draft.labelEn || !draft.labelAr || !draft.labelFr
                    }
                    onClick={add}
                  >
                    {busy ? t('saving') : t('add')}
                  </button>
                </div>
                {/* All three languages are required up front: a value added with
                    one label leaves whoever works in the other two reading a
                    bare code, which is what these lists exist to prevent. */}
                <p className="muted">{t('allThreeRequired')}</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
