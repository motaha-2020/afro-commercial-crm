import { redirect } from 'next/navigation';
import { getAccessToken, getSessionUser } from '@/lib/session';
import { apiFetch } from '@/lib/api';
import { Sidebar } from '@/components/Sidebar';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { LogoutButton } from '@/components/LogoutButton';
import { NotificationBell, type NotificationItem } from '@/components/NotificationBell';
import { AiLauncher } from '@/components/AiLauncher';

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
  const isAdmin = user.roles.some((r) => r.role === 'SYSTEM_ADMIN');

  return (
    <div className="app">
      <Sidebar isAdmin={isAdmin} />
      <div className="main">
        <div className="topbar">
          <a href={`/${locale}/profile`} style={{ fontWeight: 700, color: 'inherit', textDecoration: 'none' }}>
            {user.email}
          </a>
          <span className="badge badge-primary">{primaryRole}</span>
          <div className="spacer" />
          <NotificationBell items={notifications} />
          <LanguageSwitcher />
          <LogoutButton />
        </div>
        <div className="content">{children}</div>
      </div>
      {/* Outside .main so it floats over every screen, not inside one. */}
      <AiLauncher />
    </div>
  );
}
