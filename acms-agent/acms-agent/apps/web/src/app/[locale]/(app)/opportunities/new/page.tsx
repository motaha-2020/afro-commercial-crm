import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api';
import { getAccessToken } from '@/lib/session';
import { NewOpportunityForm } from '@/components/NewOpportunityForm';

export const dynamic = 'force-dynamic';

interface AccountOption {
  id: string;
  code: string;
  legalName: string;
  country: string;
}

export default async function NewOpportunityPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations('newOpportunity');
  const token = await getAccessToken();

  // Only accounts the caller can actually see — the same scope filter the API
  // applies, so the dropdown can never offer a customer they may not use.
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

      <NewOpportunityForm accounts={accounts.items} master={master} locale={locale} />

      <p style={{ marginTop: 16 }}>
        <Link href={`/${locale}/opportunities`}>← {t('back')}</Link>
      </p>
    </>
  );
}
