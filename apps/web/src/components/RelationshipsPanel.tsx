'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { ACCOUNT_RELATIONSHIP_TYPES } from '@acms/shared';

export interface RelationshipRow {
  id: string;
  typeCode: string;
  isOutgoing: boolean;
  notes: string | null;
  counterparty: {
    id: string;
    code: string;
    legalName: string;
    tradeName: string | null;
    country: string;
  };
}

interface AccountOption {
  id: string;
  code: string;
  legalName: string;
}

/**
 * The group tree for one account: parents, subsidiaries, joint ventures,
 * consortium partners and the competitors we keep meeting.
 *
 * Every row is shown from *this* account's side, whichever end it was recorded
 * from — the API flips the stored direction rather than storing it twice, so
 * this panel never has to know which way round the row happens to sit.
 */
export function RelationshipsPanel({
  accountId,
  relationships,
}: {
  accountId: string;
  relationships: RelationshipRow[];
}) {
  const t = useTranslations('relationships');
  const typeT = useTranslations('accountRelationshipType');
  const countryT = useTranslations('country');
  const locale = useLocale();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [toId, setToId] = useState('');
  const [typeCode, setTypeCode] = useState<string>(ACCOUNT_RELATIONSHIP_TYPES[0]);
  const [notes, setNotes] = useState('');
  const [options, setOptions] = useState<AccountOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The counterparty list is fetched only when the form is opened. A record
  // screen should not pay for a list nobody has asked to see.
  useEffect(() => {
    if (!open || options) return;
    let cancelled = false;
    fetch('/api/accounts?pageSize=100')
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        // Filtered here as well as refused by the API: offering the account
        // itself as its own parent is an option that can only end in an error.
        setOptions((d.items ?? []).filter((a: AccountOption) => a.id !== accountId));
      })
      .catch(() => setOptions([]));
    return () => {
      cancelled = true;
    };
  }, [open, options, accountId]);

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
      const res = await fetch(`/api/accounts/${accountId}/relationships`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toId, typeCode, notes: notes || undefined }),
      });
      if (!res.ok) return void (await fail(res));
      setToId('');
      setNotes('');
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setError(null);
    const res = await fetch(`/api/relationships/${id}`, { method: 'DELETE' });
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

      {open && (
        <form className="form-grid" onSubmit={submit} style={{ margin: '14px 0' }}>
          <div className="field">
            <label htmlFor="rel-to">{t('counterparty')} *</label>
            <select
              id="rel-to"
              required
              value={toId}
              onChange={(e) => setToId(e.target.value)}
              disabled={options === null}
            >
              <option value="">{options === null ? t('loading') : t('pickAccount')}</option>
              {(options ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.legalName} ({a.code})
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="rel-type">{t('type')} *</label>
            <select
              id="rel-type"
              value={typeCode}
              onChange={(e) => setTypeCode(e.target.value)}
            >
              {ACCOUNT_RELATIONSHIP_TYPES.map((code) => (
                <option key={code} value={code}>
                  {typeT(code)}
                </option>
              ))}
            </select>
          </div>

          <div className="field wide">
            <label htmlFor="rel-notes">{t('notes')}</label>
            <input id="rel-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={busy || !toId}>
              {busy ? t('saving') : t('save')}
            </button>
            {/* Said before they hit save, not after the API refuses: the link
                is recorded once and read from both files. */}
            <span className="muted">{t('storedOnceHint')}</span>
          </div>
        </form>
      )}

      {error && <p className="form-error">{error}</p>}

      <table className="data">
        <thead>
          <tr>
            <th>{t('type')}</th>
            <th>{t('counterparty')}</th>
            <th>{t('country')}</th>
            <th>{t('notes')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {relationships.map((r) => (
            <tr key={r.id}>
              <td>
                <span className="badge badge-info">{typeT(r.typeCode)}</span>
              </td>
              <td>
                <Link
                  href={`/${locale}/accounts/${r.counterparty.id}`}
                  style={{ color: 'var(--primary)', fontWeight: 600 }}
                >
                  {r.counterparty.legalName}
                </Link>
                {/* Where the row was written matters when somebody asks why
                    they cannot find it on the file they are looking at. */}
                {!r.isOutgoing && <span className="muted"> · {t('recordedThere')}</span>}
              </td>
              <td>{countryT(r.counterparty.country)}</td>
              <td>{r.notes ?? '—'}</td>
              <td>
                <button
                  type="button"
                  className="btn btn-sm btn-danger"
                  onClick={() => remove(r.id)}
                >
                  {t('remove')}
                </button>
              </td>
            </tr>
          ))}
          {relationships.length === 0 && (
            <tr>
              <td colSpan={5} style={{ color: 'var(--muted)' }}>
                {t('empty')}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
