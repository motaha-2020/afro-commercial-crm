import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';
import { Sidebar } from '@/components/Sidebar';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { LogoutButton } from '@/components/LogoutButton';

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

  const primaryRole = user.roles[0]?.role ?? 'USER';

  return (
    <div className="app">
      <Sidebar />
      <div className="main">
        <div className="topbar">
          <strong>{user.email}</strong>
          <span className="badge badge-primary">{primaryRole}</span>
          <div className="spacer" />
          <LanguageSwitcher />
          <LogoutButton />
        </div>
        <div className="content">{children}</div>
      </div>
    </div>
  );
}
