'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

export interface ContactRow {
  id: string;
  fullName: string;
  jobTitle: string | null;
  email: string | null;
  phone: string | null;
  influence: string | null;
  isPrimary: boolean;
  roles: { id: string; roleCode: string }[];
}

const INFLUENCE = ['HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'] as const;

const ROLES = [
  'DECISION_MAKER',
  'TECHNICAL_EVALUATOR',
  'COMMERCIAL_EVALUATOR',
  'PROCUREMENT',
  'FINANCE',
  'END_USER',
  'GATEKEEPER',
  'CHAMPION',
  'BLOCKER',
] as const;

export function ContactsPanel({
  accountId,
  contacts,
}: {
  accountId: string;
  contacts: ContactRow[];
}) {
  const t = useTranslations('contacts');
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    fullName: '',
    jobTitle: '',
    email: '',
    phone: '',
    influence: 'UNKNOWN',
    isPrimary: false,
  });
  const [roles, setRoles] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function set(field: string, value: string | boolean) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function toggleRole(code: string) {
    setRoles((r) => (r.includes(code) ? r.filter((x) => x !== code) : [...r, code]));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId,
          fullName: form.fullName,
          jobTitle: form.jobTitle || undefined,
          email: form.email || undefined,
          phone: form.phone || undefined,
          influence: form.influence,
          isPrimary: form.isPrimary,
          roles: roles.length ? roles : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          Array.isArray(data.message) ? data.message.join(' • ') : (data.message ?? t('failed')),
        );
      }
      setForm({
        fullName: '',
        jobTitle: '',
        email: '',
        phone: '',
        influence: 'UNKNOWN',
        isPrimary: false,
      });
      setRoles([]);
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function makePrimary(id: string) {
    setError(null);
    const res = await fetch(`/api/contacts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isPrimary: true }),
    });
    if (!res.ok) {
      const data = await res.json();
      setError(Array.isArray(data.message) ? data.message.join(' • ') : data.message);
      return;
    }
    router.refresh();
  }

  async function removeContact(id: string) {
    setError(null);
    const res = await fetch(`/api/contacts/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json();
      setError(Array.isArray(data.message) ? data.message.join(' • ') : data.message);
      return;
    }
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
            <label htmlFor="fullName">{t('name')} *</label>
            <input
              id="fullName"
              required
              minLength={2}
              value={form.fullName}
              onChange={(e) => set('fullName', e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="jobTitle">{t('jobTitle')}</label>
            <input
              id="jobTitle"
              value={form.jobTitle}
              onChange={(e) => set('jobTitle', e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="email">{t('email')}</label>
            <input
              id="email"
              type="email"
              value={form.email}
              onChange={(e) => set('email', e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="phone">{t('phone')}</label>
            <input id="phone" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
          </div>

          <div className="field">
            <label htmlFor="influence">{t('influence')}</label>
            <select
              id="influence"
              value={form.influence}
              onChange={(e) => set('influence', e.target.value)}
            >
              {INFLUENCE.map((c) => (
                <option key={c} value={c}>
                  {t(c)}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="isPrimary">{t('primary')}</label>
            <label className="btn-row" style={{ fontSize: 13 }}>
              <input
                id="isPrimary"
                type="checkbox"
                style={{ width: 'auto' }}
                checked={form.isPrimary}
                onChange={(e) => set('isPrimary', e.target.checked)}
              />
              {t('primaryHint')}
            </label>
          </div>

          <div className="field" style={{ gridColumn: '1 / -1' }}>
            {/* Roles are checkboxes, not a dropdown: the same person is
                routinely both the technical and the commercial evaluator. */}
            <label>{t('roles')}</label>
            <div className="btn-row">
              {ROLES.map((code) => (
                <label key={code} className="badge badge-info" style={{ cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    style={{ width: 'auto' }}
                    checked={roles.includes(code)}
                    onChange={() => toggleRole(code)}
                  />
                  {t(code)}
                </label>
              ))}
            </div>
          </div>

          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={busy || form.fullName.length < 2}>
              {busy ? t('saving') : t('save')}
            </button>
          </div>
        </form>
      )}

      {error && <p className="form-error">{error}</p>}

      <table className="data">
        <thead>
          <tr>
            <th>{t('name')}</th>
            <th>{t('jobTitle')}</th>
            <th>{t('email')}</th>
            <th>{t('roles')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {contacts.map((c) => (
            <tr key={c.id}>
              <td>
                {c.fullName}{' '}
                {c.isPrimary && <span className="badge badge-primary">{t('primary')}</span>}
              </td>
              <td>{c.jobTitle ?? '—'}</td>
              <td>{c.email ?? c.phone ?? '—'}</td>
              <td>
                <div className="btn-row">
                  {c.roles.map((r) => (
                    <span key={r.id} className="badge badge-info">
                      {t(r.roleCode)}
                    </span>
                  ))}
                  {c.roles.length === 0 && <span style={{ color: 'var(--muted)' }}>—</span>}
                </div>
              </td>
              <td>
                <div className="btn-row">
                  {!c.isPrimary && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => makePrimary(c.id)}
                    >
                      {t('makePrimary')}
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    onClick={() => removeContact(c.id)}
                  >
                    {t('remove')}
                  </button>
                </div>
              </td>
            </tr>
          ))}
          {contacts.length === 0 && (
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
