import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api';
import { getAccessToken } from '@/lib/session';
import { NewPartnerForm } from '@/components/NewPartnerForm';

export const dynamic = 'force-dynamic';

export default async function NewPartnerPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations('newPartner');
  const token = await getAccessToken();

  const master = await apiFetch<{ countries: string[] }>('/master-data', { token });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('title')}</h1>
          <p>{t('subtitle')}</p>
        </div>
      </div>

      <NewPartnerForm countries={master.countries} locale={locale} />

      <p style={{ marginTop: 16 }}>
        <Link href={`/${locale}/partners`}>← {t('back')}</Link>
      </p>
    </>
  );
}
