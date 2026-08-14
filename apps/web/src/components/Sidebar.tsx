'use client';

import { useTranslations, useLocale } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS: { key: string; href: string; icon: string; adminOnly?: boolean }[] = [
  { key: 'dashboard', href: 'dashboard', icon: '⌂' },
  { key: 'accounts', href: 'accounts', icon: '◫' },
  { key: 'leads', href: 'leads', icon: '◇' },
  { key: 'opportunities', href: 'opportunities', icon: '◆' },
  { key: 'suppliers', href: 'partners', icon: '⬡' },
  { key: 'approvals', href: 'approvals', icon: '✓' },
  { key: 'users', href: 'users', icon: '◉', adminOnly: true },
  { key: 'refLists', href: 'ref-lists', icon: '☰', adminOnly: true },
  { key: 'settings', href: 'settings', icon: '⚙' },
];

export function Sidebar({ isAdmin = false }: { isAdmin?: boolean }) {
  const t = useTranslations('nav');
  const app = useTranslations('app');
  const locale = useLocale();
  const pathname = usePathname();

  return (
    <aside className="sidebar">
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
              className={`nav-item${active ? ' active' : ''}`}
              aria-current={active ? 'page' : undefined}
            >
              <span className="nav-icon" aria-hidden="true">
                {item.icon}
              </span>
              {t(item.key)}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
