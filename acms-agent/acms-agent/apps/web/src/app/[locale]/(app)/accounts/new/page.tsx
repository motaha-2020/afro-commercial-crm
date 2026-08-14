import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api';
import { getAccessToken } from '@/lib/session';
import { NewAccountForm } from '@/components/NewAccountForm';

export const dynamic = 'force-dynamic';

export default async function NewAccountPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations('newAccount');
  const token = await getAccessToken();

  const master = await apiFetch<{
    accountTypes: string[];
    industries: string[];
    countries: string[];
  }>('/master-data', { token });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('title')}</h1>
          <p>{t('subtitle')}</p>
        </div>
      </div>

      <NewAccountForm master={master} locale={locale} />

      <p style={{ marginTop: 16 }}>
        <Link href={`/${locale}/accounts`}>← {t('back')}</Link>
      </p>
    </>
  );
}
