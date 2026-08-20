'use client';

import { useEffect, useState, useTransition } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

const ITEMS: { key: string; href: string; icon: string; adminOnly?: boolean }[] = [
  { key: 'dashboard', href: 'dashboard', icon: '⌂' },
  { key: 'accounts', href: 'accounts', icon: '◫' },
  { key: 'leads', href: 'leads', icon: '◇' },
  { key: 'opportunities', href: 'opportunities', icon: '◆' },
  { key: 'suppliers', href: 'partners', icon: '⬡' },
  { key: 'approvals', href: 'approvals', icon: '✓' },
  { key: 'analytics', href: 'analytics', icon: '◈' },
  { key: 'reports', href: 'reports', icon: '▤' },
  { key: 'governance', href: 'governance', icon: '⚖' },
  { key: 'users', href: 'users', icon: '◉', adminOnly: true },
  { key: 'refLists', href: 'ref-lists', icon: '☰', adminOnly: true },
  { key: 'settings', href: 'settings', icon: '⚙' },
];

const STORAGE_KEY = 'acms.sidebar.collapsed';

export function Sidebar({ isAdmin = false }: { isAdmin?: boolean }) {
  const t = useTranslations('nav');
  const app = useTranslations('app');
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  // Which link is being navigated to, so the spinner sits on the item that was
  // actually clicked. A pending flag alone could not tell them apart.
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Read after mount, not during render: the server has no localStorage, and
  // rendering one state then correcting it would flash the wrong sidebar on
  // every page load.
  useEffect(() => {
    setCollapsed(localStorage.getItem(STORAGE_KEY) === 'true');
  }, []);

  // The transition ends when the new screen commits; clearing the marker here
  // rather than in the click keeps it up for the whole wait, not just the
  // moment of the click.
  useEffect(() => {
    if (!pending) setPendingHref(null);
  }, [pending]);

  function toggle() {
    setCollapsed((was) => {
      const next = !was;
      // Remembered, because someone who folds the navigation away wants it
      // folded away — not until the next page load.
      localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });
  }

  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}`}>
      <button
        type="button"
        className="sidebar-toggle"
        onClick={toggle}
        aria-expanded={!collapsed}
        aria-label={collapsed ? t('expandNav') : t('collapseNav')}
        title={collapsed ? t('expandNav') : t('collapseNav')}
      >
        {collapsed ? '»' : '«'}
      </button>
      <div className="brand">
        <div className="brand-mark">A</div>
        <div>
          <strong>{app('shortName')}</strong>
          <span>{app('name')}</span>
        </div>
      </div>
      <div className="nav-title">{app('tagline')}</div>
      {/* A real navigation landmark: screen readers can jump straight to it,
          and on a phone it becomes the horizontal strip the layout needs. */}
      <nav aria-label={app('tagline')}>
        {ITEMS.filter((item) => !item.adminOnly || isAdmin).map((item) => {
          const href = `/${locale}/${item.href}`;
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={item.key}
              href={href}
              className={`nav-item${active ? ' active' : ''}${
                pendingHref === href ? ' pending' : ''
              }`}
              aria-current={active ? 'page' : undefined}
              onClick={(e) => {
                // Modified clicks belong to the browser — a new tab is not a
                // navigation this sidebar is waiting for.
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                if (active) return;
                e.preventDefault();
                setPendingHref(href);
                startTransition(() => router.push(href));
              }}
              // Collapsed, the label is hidden and the icon is decorative, so
              // the link would otherwise have no accessible name at all.
              title={t(item.key)}
              aria-label={t(item.key)}
            >
              <span className="nav-icon" aria-hidden="true">
                {item.icon}
              </span>
              <span className="nav-label">{t(item.key)}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
