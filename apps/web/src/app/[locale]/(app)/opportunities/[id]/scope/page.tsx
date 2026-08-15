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
        <div className="page-title">
          <Link
            className="page-back"
            href={`/${locale}/opportunities/${id}`}
            aria-label={t('backToOpportunity')}
            title={t('backToOpportunity')}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path
                d="M15 5l-7 7 7 7"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Link>
          <div>
            <h1>{t('title')}</h1>
            <p>
              {scope.opportunity.code} • {scope.opportunity.name}
            </p>
          </div>
        </div>
        {/* Packages are imported for the opportunity as a whole; the items
            inside one are imported from that package's own row, where the
            package is already chosen. */}
        <div className="head-actions">
          <Link
            className="btn"
            href={`/${locale}/import/scope-packages?contextId=${id}&back=/${locale}/opportunities/${id}/scope`}
          >
            {t('importPackages')}
          </Link>
        </div>
      </div>

      <ScopeBuilder opportunityId={id} locale={locale} scope={scope} />

      <p style={{ marginTop: 16 }}>
        <Link href={`/${locale}/opportunities/${id}`}>← {t('backToOpportunity')}</Link>
      </p>
    </>
  );
}
