'use client';

import { useLocale } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';

const LOCALES: { code: string; label: string }[] = [
  { code: 'ar', label: 'العربية' },
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
];

export function LanguageSwitcher() {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();

  function change(next: string) {
    // Swap the leading /<locale> segment and navigate.
    const rest = pathname.replace(/^\/(ar|en|fr)/, '');
    router.push(`/${next}${rest}`);
  }

  return (
    <select
      value={locale}
      onChange={(e) => change(e.target.value)}
      className="btn"
      aria-label="language"
    >
      {LOCALES.map((l) => (
        <option key={l.code} value={l.code}>
          {l.label}
        </option>
      ))}
    </select>
  );
}
