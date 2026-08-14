import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api';
import { getAccessToken } from '@/lib/session';
import { NewAccountForm } from '@/components/NewAccountForm';
import { buildRefLabels, type RefListPayload } from '@/lib/ref-labels';

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
    lists?: RefListPayload[];
  }>('/master-data', { token });

  // Labels travel with the values, so a value an administrator added minutes
  // ago reads as words here without anyone editing a translation file.
  const labels = buildRefLabels(master.lists, locale);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('title')}</h1>
          <p>{t('subtitle')}</p>
        </div>
      </div>

      <NewAccountForm master={master} labels={labels} locale={locale} />

      <p style={{ marginTop: 16 }}>
        <Link href={`/${locale}/accounts`}>← {t('back')}</Link>
      </p>
    </>
  );
}
