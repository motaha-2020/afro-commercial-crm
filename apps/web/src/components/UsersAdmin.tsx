'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

export interface OrgUnitOption {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  type: string;
}
export interface UsersMeta {
  orgUnits: OrgUnitOption[];
  roles: string[];
  scopes: string[];
}
export interface AdminUser {
  id: string;
  email: string;
  fullNameAr: string;
  fullNameEn: string;
  jobTitle?: string | null;
  isActive: boolean;
  mustChangePassword: boolean;
  orgUnit?: { id: string; code: string; nameAr: string; nameEn: string } | null;
  roles: { role: string; scope: string }[];
  lastLoginAt?: string | null;
}

interface RolePair {
  role: string;
  scope: string;
}

function errText(e: unknown): string {
  const m = (e as { message?: string | string[] })?.message;
  if (Array.isArray(m)) return m.join(' · ');
  return m ?? 'Error';
}

export function UsersAdmin({
  users,
  meta,
  locale,
}: {
  users: AdminUser[];
  meta: UsersMeta;
  locale: string;
}) {
  const t = useTranslations('users');
  const router = useRouter();
  const ar = locale === 'ar';
  const orgName = (o: { nameAr: string; nameEn: string } | null | undefined) =>
    !o ? '—' : ar ? o.nameAr : o.nameEn;

  const firstRole = meta.roles[0] ?? 'ACCOUNT_MANAGER';
  const firstScope = meta.scopes[0] ?? 'OWN';

  const [form, setForm] = useState({
    email: '',
    fullNameAr: '',
    fullNameEn: '',
    jobTitle: '',
    phone: '',
    orgUnitId: meta.orgUnits[0]?.id ?? '',
    locale: 'ar',
  });
  const [roles, setRoles] = useState<RolePair[]>([{ role: firstRole, scope: firstScope }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newSecret, setNewSecret] = useState<{ email: string; password: string } | null>(null);

  function set(field: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }
  function setRole(i: number, key: keyof RolePair, value: string) {
    setRoles((rs) => rs.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)));
  }
  function addRole() {
    setRoles((rs) => [...rs, { role: firstRole, scope: firstScope }]);
  }
  function removeRole(i: number) {
    setRoles((rs) => (rs.length > 1 ? rs.filter((_, idx) => idx !== i) : rs));
  }

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNewSecret(null);
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: form.email,
          fullNameAr: form.fullNameAr,
          fullNameEn: form.fullNameEn,
          jobTitle: form.jobTitle || undefined,
          phone: form.phone || undefined,
          orgUnitId: form.orgUnitId,
          locale: form.locale,
          roles,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw body;
      setNewSecret({ email: body.email, password: body.temporaryPassword });
      setForm((f) => ({ ...f, email: '', fullNameAr: '', fullNameEn: '', jobTitle: '', phone: '' }));
      setRoles([{ role: firstRole, scope: firstScope }]);
      router.refresh();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  async function act(url: string, method = 'POST') {
    setError(null);
    try {
      const res = await fetch(url, { method });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw body;
      if (body.temporaryPassword) {
        setNewSecret({ email: body.email ?? '', password: body.temporaryPassword });
      }
      router.refresh();
    } catch (err) {
      setError(errText(err));
    }
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {newSecret && (
        <div className="panel" style={{ borderColor: 'var(--primary)', background: 'var(--primary-soft)' }}>
          <h3 style={{ marginTop: 0 }}>{t('tempTitle')}</h3>
          <p className="muted" style={{ marginTop: 0 }}>{t('tempHint')}</p>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            {newSecret.email && <span className="badge badge-info">{newSecret.email}</span>}
            <code style={{ fontSize: 18, fontWeight: 700, letterSpacing: '.5px', direction: 'ltr' }}>
              {newSecret.password}
            </code>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => navigator.clipboard?.writeText(newSecret.password)}
            >
              {t('copy')}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNewSecret(null)}>
              {t('dismiss')}
            </button>
          </div>
        </div>
      )}

      {error && <div className="form-error">{error}</div>}

      {/* Create user */}
      <div className="panel">
        <h2>{t('createTitle')}</h2>
        <form onSubmit={createUser}>
          <div className="form-grid">
            <label className="field">
              <span>{t('email')}</span>
              <input type="email" required value={form.email} onChange={(e) => set('email', e.target.value)} />
            </label>
            <label className="field">
              <span>{t('orgUnit')}</span>
              <select value={form.orgUnitId} onChange={(e) => set('orgUnitId', e.target.value)} required>
                {meta.orgUnits.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.code} · {orgName(o)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t('nameAr')}</span>
              <input required value={form.fullNameAr} onChange={(e) => set('fullNameAr', e.target.value)} />
            </label>
            <label className="field">
              <span>{t('nameEn')}</span>
              <input required value={form.fullNameEn} onChange={(e) => set('fullNameEn', e.target.value)} />
            </label>
            <label className="field">
              <span>{t('jobTitle')}</span>
              <input value={form.jobTitle} onChange={(e) => set('jobTitle', e.target.value)} />
            </label>
            <label className="field">
              <span>{t('phone')}</span>
              <input value={form.phone} onChange={(e) => set('phone', e.target.value)} />
            </label>

            <div className="field wide">
              <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>
                {t('roles')}
              </span>
              <div style={{ display: 'grid', gap: 8 }}>
                {roles.map((r, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <select value={r.role} onChange={(e) => setRole(i, 'role', e.target.value)} style={{ flex: 2 }}>
                      {meta.roles.map((role) => (
                        <option key={role} value={role}>{role}</option>
                      ))}
                    </select>
                    <select value={r.scope} onChange={(e) => setRole(i, 'scope', e.target.value)} style={{ flex: 1 }}>
                      {meta.scopes.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeRole(i)} aria-label={t('removeRole')}>
                      ×
                    </button>
                  </div>
                ))}
                <div>
                  <button type="button" className="btn btn-sm" onClick={addRole}>+ {t('addRole')}</button>
                </div>
              </div>
            </div>

            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? t('creating') : t('create')}
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Users list */}
      <div className="panel">
        <h2>{t('listTitle')} ({users.length})</h2>
        <div style={{ overflowX: 'auto' }}>
          <table className="data">
            <thead>
              <tr>
                <th>{t('name')}</th>
                <th>{t('email')}</th>
                <th>{t('orgUnit')}</th>
                <th>{t('roles')}</th>
                <th>{t('statusCol')}</th>
                <th>{t('actions')}</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <UserRow key={u.id} u={u} meta={meta} locale={locale} orgName={orgName} onAct={act} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function UserRow({
  u,
  meta,
  locale,
  orgName,
  onAct,
}: {
  u: AdminUser;
  meta: UsersMeta;
  locale: string;
  orgName: (o: { nameAr: string; nameEn: string } | null | undefined) => string;
  onAct: (url: string, method?: string) => void;
}) {
  const t = useTranslations('users');
  const router = useRouter();
  const ar = locale === 'ar';
  const [open, setOpen] = useState(false);
  const [role, setNewRole] = useState(meta.roles[0] ?? 'ACCOUNT_MANAGER');
  const [scope, setNewScope] = useState(meta.scopes[0] ?? 'OWN');
  const [err, setErr] = useState<string | null>(null);

  async function grant() {
    setErr(null);
    try {
      const res = await fetch(`/api/users/${u.id}/roles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, scope }),
      });
      if (!res.ok) throw await res.json();
      router.refresh();
    } catch (e) {
      const m = (e as { message?: string | string[] })?.message;
      setErr(Array.isArray(m) ? m.join(' · ') : m ?? 'Error');
    }
  }
  async function revoke(r: string) {
    setErr(null);
    try {
      const res = await fetch(`/api/users/${u.id}/roles/${r}`, { method: 'DELETE' });
      if (!res.ok) throw await res.json();
      router.refresh();
    } catch (e) {
      const m = (e as { message?: string | string[] })?.message;
      setErr(Array.isArray(m) ? m.join(' · ') : m ?? 'Error');
    }
  }

  return (
    <>
      <tr>
        <td>
          <strong>{ar ? u.fullNameAr : u.fullNameEn}</strong>
          {u.jobTitle && <div className="muted" style={{ fontSize: 12 }}>{u.jobTitle}</div>}
        </td>
        <td style={{ direction: 'ltr' }}>{u.email}</td>
        <td>{orgName(u.orgUnit)}</td>
        <td>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {u.roles.map((r) => (
              <span key={r.role} className="badge badge-primary" title={r.scope}>
                {r.role}@{r.scope}
              </span>
            ))}
          </div>
        </td>
        <td>
          {u.isActive ? (
            <span className="badge badge-success">{t('active')}</span>
          ) : (
            <span className="badge badge-danger">{t('inactive')}</span>
          )}
          {u.mustChangePassword && (
            <span className="badge badge-warning" style={{ marginInlineStart: 4 }}>{t('mustChange')}</span>
          )}
        </td>
        <td>
          <div className="btn-row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-sm" onClick={() => setOpen((o) => !o)}>
              {t('manageRoles')}
            </button>
            <button type="button" className="btn btn-sm" onClick={() => onAct(`/api/users/${u.id}/reset-password`)}>
              {t('resetPw')}
            </button>
            {u.isActive ? (
              <button type="button" className="btn btn-danger btn-sm" onClick={() => onAct(`/api/users/${u.id}/deactivate`)}>
                {t('deactivate')}
              </button>
            ) : (
              <button type="button" className="btn btn-sm" onClick={() => onAct(`/api/users/${u.id}/reactivate`)}>
                {t('reactivate')}
              </button>
            )}
          </div>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={6} style={{ background: 'var(--panel-2)' }}>
            {err && <div className="form-error" style={{ marginBottom: 8 }}>{err}</div>}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {u.roles.map((r) => (
                <span key={r.role} className="badge badge-info">
                  {r.role}@{r.scope}
                  <button
                    type="button"
                    onClick={() => revoke(r.role)}
                    aria-label={t('revoke')}
                    style={{ marginInlineStart: 6, border: 'none', background: 'none', cursor: 'pointer', fontWeight: 700 }}
                  >
                    ×
                  </button>
                </span>
              ))}
              <span style={{ width: 1, height: 20, background: 'var(--border)' }} />
              <select value={role} onChange={(e) => setNewRole(e.target.value)}>
                {meta.roles.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
              <select value={scope} onChange={(e) => setNewScope(e.target.value)}>
                {meta.scopes.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <button type="button" className="btn btn-sm btn-primary" onClick={grant}>+ {t('grant')}</button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
