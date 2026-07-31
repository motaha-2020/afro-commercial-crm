import { redirect } from 'next/navigation';
import { getAccessToken, getSessionUser } from '@/lib/session';
import { apiFetch } from '@/lib/api';
import { Sidebar } from '@/components/Sidebar';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { LogoutButton } from '@/components/LogoutButton';
import { NotificationBell, type NotificationItem } from '@/components/NotificationBell';

export default async function AppLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const user = await getSessionUser();
  if (!user) redirect(`/${locale}/login`);

  const token = await getAccessToken();
  // A failed fetch must not blank the whole application shell — an empty bell
  // is a far better outcome than an unusable page.
  const notifications = await apiFetch<NotificationItem[]>('/notifications', { token }).catch(
    () => [] as NotificationItem[],
  );

  const primaryRole = user.roles[0]?.role ?? 'USER';

  return (
    <div className="app">
      <Sidebar />
      <div className="main">
        <div className="topbar">
          <strong>{user.email}</strong>
          <span className="badge badge-primary">{primaryRole}</span>
          <div className="spacer" />
          <NotificationBell items={notifications} />
          <LanguageSwitcher />
          <LogoutButton />
        </div>
        <div className="content">{children}</div>
      </div>
    </div>
  );
}
