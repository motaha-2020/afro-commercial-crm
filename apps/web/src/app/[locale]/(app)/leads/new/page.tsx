import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api';
import { getAccessToken } from '@/lib/session';
import { NewLeadForm } from '@/components/NewLeadForm';

export const dynamic = 'force-dynamic';

interface AccountOption {
  id: string;
  code: string;
  legalName: string;
  country: string;
}

export default async function NewLeadPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations('newLead');
  const token = await getAccessToken();

  const [accounts, master] = await Promise.all([
    apiFetch<{ items: AccountOption[] }>('/accounts?pageSize=100', { token }),
    apiFetch<{
      industries: string[];
      leadSources: string[];
      currencies: string[];
      countries: string[];
    }>('/master-data', { token }),
  ]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('title')}</h1>
          <p>{t('subtitle')}</p>
        </div>
      </div>

      <NewLeadForm accounts={accounts.items} master={master} locale={locale} />

      <p style={{ marginTop: 16 }}>
        <Link href={`/${locale}/leads`}>← {t('back')}</Link>
      </p>
    </>
  );
}
