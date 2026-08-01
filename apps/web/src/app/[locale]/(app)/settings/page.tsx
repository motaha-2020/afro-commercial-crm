import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api';
import { getAccessToken } from '@/lib/session';
import {
  ApprovalPolicySettings,
  type PolicyKeyRow,
} from '@/components/ApprovalPolicySettings';

export const dynamic = 'force-dynamic';

interface PolicyResponse {
  scope: { country: string | null; orgUnitId: string | null; opportunityId: string | null };
  keys: PolicyKeyRow[];
  unconfigured: string[];
  canEdit: boolean;
}

export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ country?: string; orgUnitId?: string }>;
}) {
  await params;
  const { country, orgUnitId } = await searchParams;
  const t = await getTranslations('settings');
  const token = await getAccessToken();

  const query = new URLSearchParams();
  if (country) query.set('country', country);
  if (orgUnitId) query.set('orgUnitId', orgUnitId);

  const policies = await apiFetch<PolicyResponse>(
    `/approval-policies${query.toString() ? `?${query}` : ''}`,
    { token },
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('title')}</h1>
          <p>{t('subtitle')}</p>
        </div>
      </div>

      <ApprovalPolicySettings
        keys={policies.keys}
        canEdit={policies.canEdit}
        scope={policies.scope}
      />
    </>
  );
}
