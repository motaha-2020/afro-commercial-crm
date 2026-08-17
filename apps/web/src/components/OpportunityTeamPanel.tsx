'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';

export interface TeamMemberRow {
  id: string;
  role: string;
  isLead: boolean;
  user: {
    id: string;
    email: string;
    fullNameAr: string;
    fullNameEn: string;
    jobTitle: string | null;
    isActive: boolean;
  };
}

interface UserOption {
  id: string;
  fullNameAr: string;
  fullNameEn: string;
  isActive: boolean;
  roles: { role: string }[];
}

/**
 * Who is answerable for what on this bid.
 *
 * The role list offered for a person is the set of roles that person actually
 * holds — the API refuses anything else, and offering a choice that can only
 * be refused teaches people to ignore the form.
 */
export function OpportunityTeamPanel({
  opportunityId,
  members,
  hasLead,
}: {
  opportunityId: string;
  members: TeamMemberRow[];
  hasLead: boolean;
}) {
  const t = useTranslations('team');
  const roleT = useTranslations('role');
  const locale = useLocale();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState('');
  const [isLead, setIsLead] = useState(false);
  const [users, setUsers] = useState<UserOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || users) return;
    let cancelled = false;
    // Not /api/users: that one is admin-only and carries email addresses and
    // login history a bid-staffing form has no business seeing.
    fetch(`/api/opportunities/${opportunityId}/team/candidates`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setUsers(d.items ?? []);
      })
      .catch(() => setUsers([]));
    return () => {
      cancelled = true;
    };
  }, [open, users, opportunityId]);

  const availableRoles = useMemo(() => {
    const picked = users?.find((u) => u.id === userId);
    return picked?.roles.map((r) => r.role) ?? [];
  }, [users, userId]);

  // A role left selected from the previous person may be one this one does not
  // hold; clearing it is better than submitting a value the API will refuse.
  useEffect(() => {
    if (role && !availableRoles.includes(role)) setRole('');
  }, [availableRoles, role]);

  const name = (u: { fullNameAr: string; fullNameEn: string }) =>
    locale === 'ar' ? u.fullNameAr : u.fullNameEn;

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
      const res = await fetch(`/api/opportunities/${opportunityId}/team`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, role, isLead }),
      });
      if (!res.ok) return void (await fail(res));
      setUserId('');
      setRole('');
      setIsLead(false);
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function makeLead(id: string) {
    setError(null);
    const res = await fetch(`/api/team-members/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isLead: true }),
    });
    if (!res.ok) return void (await fail(res));
    router.refresh();
  }

  async function remove(id: string) {
    setError(null);
    const res = await fetch(`/api/team-members/${id}`, { method: 'DELETE' });
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

      {/* An unled bid and a bid whose lead is simply off-screen look the same
          otherwise, and only one of them is a problem. */}
      {members.length > 0 && !hasLead && (
        <div className="readiness not-ok" style={{ marginTop: 12 }}>
          {t('noLead')}
        </div>
      )}

      {open && (
        <form className="form-grid" onSubmit={submit} style={{ margin: '14px 0' }}>
          <div className="field">
            <label htmlFor="team-user">{t('member')} *</label>
            <select
              id="team-user"
              required
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              disabled={users === null}
            >
              <option value="">{users === null ? t('loading') : t('pickMember')}</option>
              {(users ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {name(u)}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="team-role">{t('role')} *</label>
            <select
              id="team-role"
              required
              value={role}
              onChange={(e) => setRole(e.target.value)}
              disabled={!userId}
            >
              <option value="">{userId ? t('pickRole') : t('pickMemberFirst')}</option>
              {availableRoles.map((r) => (
                <option key={r} value={r}>
                  {roleT(r)}
                </option>
              ))}
            </select>
            {userId && availableRoles.length === 0 && (
              <span className="muted">{t('noRoles')}</span>
            )}
          </div>

          <div className="field wide">
            <label className="btn-row" style={{ fontSize: 13 }}>
              <input
                type="checkbox"
                style={{ width: 'auto' }}
                checked={isLead}
                onChange={(e) => setIsLead(e.target.checked)}
              />
              {t('leadHint')}
            </label>
          </div>

          <div className="form-actions">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={busy || !userId || !role}
            >
              {busy ? t('saving') : t('save')}
            </button>
            {/* The same person can hold two roles on one bid, and each is a row. */}
            <span className="muted">{t('rolesAreRowsHint')}</span>
          </div>
        </form>
      )}

      {error && <p className="form-error">{error}</p>}

      <table className="data">
        <thead>
          <tr>
            <th>{t('member')}</th>
            <th>{t('role')}</th>
            <th>{t('jobTitle')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.id}>
              <td>
                {name(m.user)}{' '}
                {m.isLead && <span className="badge badge-primary">{t('lead')}</span>}
              </td>
              <td>
                <span className="badge badge-info">{roleT(m.role)}</span>
              </td>
              <td>{m.user.jobTitle ?? '—'}</td>
              <td>
                <div className="btn-row">
                  {!m.isLead && (
                    <button type="button" className="btn btn-sm" onClick={() => makeLead(m.id)}>
                      {t('makeLead')}
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    onClick={() => remove(m.id)}
                  >
                    {t('remove')}
                  </button>
                </div>
              </td>
            </tr>
          ))}
          {members.length === 0 && (
            <tr>
              <td colSpan={4} style={{ color: 'var(--muted)' }}>
                {t('empty')}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
