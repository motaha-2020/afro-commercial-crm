import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api';
import { getAccessToken, getSessionUser } from '@/lib/session';
import { RefListsAdmin, type RefListRow } from '@/components/RefListsAdmin';

export const dynamic = 'force-dynamic';

export default async function RefListsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations('refLists');
  const session = await getSessionUser();
  const isAdmin = session?.roles.some((r) => r.role === 'SYSTEM_ADMIN') ?? false;

  // Checked here as well as in the API: the API is the boundary that matters,
  // but rendering an editor someone cannot use is its own kind of wrong.
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
  const lists = await apiFetch<RefListRow[]>('/ref-lists', { token }).catch(
    () => [] as RefListRow[],
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('title')}</h1>
          <p>{t('subtitle')}</p>
        </div>
      </div>

      <RefListsAdmin lists={lists} locale={locale} />

      <p style={{ marginTop: 16 }}>
        <Link href={`/${locale}/dashboard`}>← {t('back')}</Link>
      </p>
    </>
  );
}
