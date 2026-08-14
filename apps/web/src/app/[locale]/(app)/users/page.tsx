import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api';
import { getAccessToken, getSessionUser } from '@/lib/session';
import { UsersAdmin, type AdminUser, type UsersMeta } from '@/components/UsersAdmin';

export const dynamic = 'force-dynamic';

export default async function UsersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations('users');
  const session = await getSessionUser();
  const isAdmin = session?.roles.some((r) => r.role === 'SYSTEM_ADMIN') ?? false;

  if (!isAdmin) {
    return (
      <div className="page-head">
        <div>
          <h1>{t('title')}</h1>
          <p>{t('forbidden')}</p>
        </div>
      </div>
    );
  }

  const token = await getAccessToken();
  const [users, meta] = await Promise.all([
    apiFetch<AdminUser[]>('/users', { token }).catch(() => [] as AdminUser[]),
    apiFetch<UsersMeta>('/users/meta', { token }).catch(
      () => ({ orgUnits: [], roles: [], scopes: [] }) as UsersMeta,
    ),
  ]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('title')}</h1>
          <p>{t('subtitle')}</p>
        </div>
      </div>

      <UsersAdmin users={users} meta={meta} locale={locale} />

      <p style={{ marginTop: 16 }}>
        <Link href={`/${locale}/dashboard`}>← {t('back')}</Link>
      </p>
    </>
  );
}
