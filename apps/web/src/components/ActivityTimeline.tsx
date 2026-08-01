'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';

export interface ActivityRow {
  id: string;
  type: string;
  subject: string;
  body: string | null;
  dueAt: string | null;
  completedAt: string | null;
  createdAt: string;
  user: { fullNameEn: string; fullNameAr: string };
}

/** Exactly one of these is set by the page that hosts the timeline. */
export interface ActivityAnchor {
  accountId?: string;
  contactId?: string;
  opportunityId?: string;
  leadId?: string;
}

const TYPES = ['CALL', 'MEETING', 'EMAIL', 'SITE_VISIT', 'NOTE', 'TASK'] as const;

/** A task is scheduled; the rest record something that already happened. */
const NEEDS_DUE_DATE = new Set(['TASK']);

export function ActivityTimeline({
  activities,
  anchor,
  readOnly = false,
}: {
  activities: ActivityRow[];
  anchor: ActivityAnchor;
  readOnly?: boolean;
}) {
  const t = useTranslations('activities');
  const locale = useLocale();
  const router = useRouter();

  const [type, setType] = useState<string>('CALL');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function log(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/activities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...anchor,
          type,
          subject,
          body: body || undefined,
          dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          Array.isArray(data.message) ? data.message.join(' • ') : (data.message ?? t('failed')),
        );
      }
      setSubject('');
      setBody('');
      setDueAt('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function complete(id: string) {
    setError(null);
    const res = await fetch(`/api/activities/${id}/complete`, { method: 'PATCH' });
    if (!res.ok) {
      const data = await res.json();
      setError(Array.isArray(data.message) ? data.message.join(' • ') : data.message);
      return;
    }
    router.refresh();
  }

  const now = Date.now();

  return (
    <div className="panel">
      <h2 style={{ marginTop: 0, fontSize: 15 }}>{t('title')}</h2>

      {!readOnly && (
        <form className="form-grid" onSubmit={log} style={{ marginBottom: 16 }}>
          <div className="field">
            <label htmlFor="activityType">{t('type')}</label>
            <select id="activityType" value={type} onChange={(e) => setType(e.target.value)}>
              {TYPES.map((c) => (
                <option key={c} value={c}>
                  {t(c)}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="activitySubject">{t('subject')} *</label>
            <input
              id="activitySubject"
              required
              minLength={2}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={t('subjectPlaceholder')}
            />
          </div>

          {NEEDS_DUE_DATE.has(type) && (
            <div className="field">
              <label htmlFor="activityDue">{t('dueAt')}</label>
              <input
                id="activityDue"
                type="date"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
              />
            </div>
          )}

          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label htmlFor="activityBody">{t('notes')}</label>
            <textarea
              id="activityBody"
              rows={2}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>

          <div className="form-actions">
            <button type="submit" className="btn" disabled={busy || subject.length < 2}>
              {busy ? t('saving') : t('log')}
            </button>
            {error && <p className="form-error">{error}</p>}
          </div>
        </form>
      )}

      <table className="data">
        <thead>
          <tr>
            <th>{t('type')}</th>
            <th>{t('subject')}</th>
            <th>{t('who')}</th>
            <th>{t('when')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {activities.map((a) => {
            const overdue = !a.completedAt && a.dueAt && new Date(a.dueAt).getTime() < now;
            return (
              <tr key={a.id}>
                <td>{t(a.type)}</td>
                <td>
                  {a.subject}
                  {a.body && (
                    <div style={{ color: 'var(--muted)', fontSize: 12 }}>{a.body}</div>
                  )}
                </td>
                <td>{locale === 'ar' ? a.user.fullNameAr : a.user.fullNameEn}</td>
                <td>
                  {(a.completedAt ?? a.dueAt ?? a.createdAt).slice(0, 10)}
                  {overdue && (
                    <span className="badge health-RED" style={{ marginInlineStart: 6 }}>
                      {t('overdue')}
                    </span>
                  )}
                </td>
                <td>
                  {a.completedAt ? (
                    <span className="badge badge-info">{t('done')}</span>
                  ) : (
                    !readOnly && (
                      <button type="button" className="btn btn-sm" onClick={() => complete(a.id)}>
                        {t('complete')}
                      </button>
                    )
                  )}
                </td>
              </tr>
            );
          })}
          {activities.length === 0 && (
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
