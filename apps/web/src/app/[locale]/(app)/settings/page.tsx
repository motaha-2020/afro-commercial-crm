import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api';
import { getAccessToken } from '@/lib/session';
import {
  ApprovalPolicySettings,
  type PolicyKeyRow,
} from '@/components/ApprovalPolicySettings';
import { CostRuleSettings, type CostRuleRow } from '@/components/CostRuleSettings';
import { WorkflowEditor, type WorkflowRow } from '@/components/WorkflowEditor';
import { TaxRuleSettings, type TaxRuleRow } from '@/components/TaxRuleSettings';

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

  const [policies, costRules] = await Promise.all([
    apiFetch<PolicyResponse>(`/approval-policies${query.toString() ? `?${query}` : ''}`, {
      token,
    }),
    apiFetch<{ rules: CostRuleRow[]; canApprove: boolean }>(
      `/cost-rules${query.toString() ? `?${query}` : ''}`,
      { token },
    ).catch(() => ({ rules: [] as CostRuleRow[], canApprove: false })),
  ]);

  // Only the three roles that own the limits may read this, and the API says so
  // with a 403. The editor simply does not appear for anyone else rather than
  // appearing and refusing every click.
  const workflows = await apiFetch<{ workflows: WorkflowRow[] }>('/workflows', { token }).catch(
    () => null,
  );

  const taxRules = await apiFetch<{ rules: TaxRuleRow[]; canApprove: boolean }>(
    `/tax-rules${query.toString() ? `?${query}` : ''}`,
    { token },
  ).catch(() => ({ rules: [] as TaxRuleRow[], canApprove: false }));

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

      <CostRuleSettings rules={costRules.rules} canApprove={costRules.canApprove} />

      <TaxRuleSettings rules={taxRules.rules} canApprove={taxRules.canApprove} />

      {workflows && (
        <>
          <h2 style={{ marginTop: 24, fontSize: 16 }}>{t('workflowsTitle')}</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            {t('workflowsSubtitle')}
          </p>
          <WorkflowEditor workflows={workflows.workflows} />
        </>
      )}
    </>
  );
}
