'use client';

import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';

export function LogoutButton() {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations('nav');

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push(`/${locale}/login`);
  }

  return (
    <button className="btn" onClick={logout}>
      {t('logout')}
    </button>
  );
}
