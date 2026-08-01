import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api';
import { getAccessToken } from '@/lib/session';
import { ScopeBuilder, type ScopeOverview } from '@/components/ScopeBuilder';

export const dynamic = 'force-dynamic';

export default async function ScopeBuilderPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const t = await getTranslations('scopeBuilder');
  const token = await getAccessToken();

  let scope: ScopeOverview;
  try {
    scope = await apiFetch<ScopeOverview>(`/opportunities/${id}/scope`, { token });
  } catch {
    notFound();
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('title')}</h1>
          <p>
            {scope.opportunity.code} • {scope.opportunity.name}
          </p>
        </div>
      </div>

      <ScopeBuilder opportunityId={id} scope={scope} />

      <p style={{ marginTop: 16 }}>
        <Link href={`/${locale}/opportunities/${id}`}>← {t('backToOpportunity')}</Link>
      </p>
    </>
  );
}
