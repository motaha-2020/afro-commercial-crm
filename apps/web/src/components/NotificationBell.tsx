'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  entityType: string | null;
  entityId: string | null;
  readAt: string | null;
  createdAt: string;
}

/**
 * Notification rules decide who hears about an event; this is where they hear
 * it. Read state is written through the BFF route and the page is then
 * refreshed, so the badge count comes from the server rather than from local
 * state that can drift out of step with it.
 */
export function NotificationBell({ items }: { items: NotificationItem[] }) {
  const t = useTranslations('notifications');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const unread = items.filter((n) => !n.readAt).length;

  async function mark(id?: string) {
    setBusy(true);
    try {
      await fetch('/api/notifications/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(id ? { id } : {}),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bell-wrap">
      <button
        type="button"
        className="bell"
        onClick={() => setOpen((v) => !v)}
        aria-label={t('title')}
        aria-expanded={open}
      >
        <span aria-hidden>🔔</span>
        {unread > 0 && <span className="bell-count">{unread}</span>}
      </button>

      {open && (
        <div className="bell-panel">
          <div className="bell-head">
            <strong>{t('title')}</strong>
            {unread > 0 && (
              <button type="button" onClick={() => void mark()} disabled={busy}>
                {t('markAllRead')}
              </button>
            )}
          </div>

          {items.length === 0 && <p className="bell-empty">{t('empty')}</p>}

          {items.map((n) => (
            <button
              key={n.id}
              type="button"
              className={`bell-item${n.readAt ? '' : ' unread'}`}
              onClick={() => !n.readAt && void mark(n.id)}
            >
              <strong>{n.title}</strong>
              {n.body && <span>{n.body}</span>}
              <time dateTime={n.createdAt}>
                {new Date(n.createdAt).toLocaleString()}
              </time>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
