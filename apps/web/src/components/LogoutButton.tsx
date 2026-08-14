'use client';

import { useLocale, useTranslations } from 'next-intl';

export function LogoutButton() {
  const locale = useLocale();
  const t = useTranslations('nav');

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    // Hard navigation so the App Router cache from the signed-in session is
    // discarded — a client push would keep serving cached authed pages.
    window.location.assign(`/${locale}/login`);
  }

  return (
    <button className="btn" onClick={logout}>
      {t('logout')}
    </button>
  );
}
