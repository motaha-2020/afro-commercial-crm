import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api';
import { getAccessToken } from '@/lib/session';
import {
  CostingBuilder,
  type CostingScenarioRow,
  type CostingVersionDetail,
  type CostElementOption,
  type ResourceOption,
} from '@/components/CostingBuilder';

export const dynamic = 'force-dynamic';

interface Opportunity {
  id: string;
  code: string;
  name: string;
}

export default async function CostingBuilderPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ version?: string }>;
}) {
  const { locale, id } = await params;
  const { version: versionId } = await searchParams;
  const t = await getTranslations('costingBuilder');
  const token = await getAccessToken();

  const [opportunity, scenarios, costElements, resources] = await Promise.all([
    apiFetch<Opportunity>(`/opportunities/${id}`, { token }),
    apiFetch<CostingScenarioRow[]>(`/opportunities/${id}/costing`, { token }),
    apiFetch<CostElementOption[]>('/cost-elements', { token }).catch(() => []),
    apiFetch<ResourceOption[]>('/resources', { token }).catch(() => []),
  ]);

  const version = versionId
    ? await apiFetch<CostingVersionDetail>(`/costing/versions/${versionId}`, { token }).catch(
        () => null,
      )
    : null;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('title')}</h1>
          <p>
            {opportunity.code} • {opportunity.name}
          </p>
        </div>
      </div>

      <CostingBuilder
        opportunityId={id}
        locale={locale}
        scenarios={scenarios}
        version={version}
        costElements={costElements}
        resources={resources}
      />

      <p style={{ marginTop: 16 }}>
        <Link href={`/${locale}/opportunities/${id}`}>← {t('backToOpportunity')}</Link>
      </p>
    </>
  );
}
