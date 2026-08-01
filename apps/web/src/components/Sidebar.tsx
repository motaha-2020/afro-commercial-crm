'use client';

import { useTranslations, useLocale } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS: { key: string; href: string; icon: string }[] = [
  { key: 'dashboard', href: 'dashboard', icon: '⌂' },
  { key: 'accounts', href: 'accounts', icon: '◫' },
  { key: 'leads', href: 'leads', icon: '◇' },
  { key: 'opportunities', href: 'opportunities', icon: '◆' },
];

export function Sidebar() {
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
      {ITEMS.map((item) => {
        const href = `/${locale}/${item.href}`;
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={item.key}
            href={href}
            className={`nav-item${active ? ' active' : ''}`}
          >
            <span className="nav-icon">{item.icon}</span>
            {t(item.key)}
          </Link>
        );
      })}
    </aside>
  );
}
