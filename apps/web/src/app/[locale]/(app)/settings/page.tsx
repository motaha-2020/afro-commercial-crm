import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api';
import { getAccessToken } from '@/lib/session';
import {
  ApprovalPolicySettings,
  type PolicyKeyRow,
} from '@/components/ApprovalPolicySettings';
import { CostRuleSettings, type CostRuleRow } from '@/components/CostRuleSettings';
import { TargetSettings, type TargetRow } from '@/components/TargetSettings';
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

  // Reading a target is open to anyone who can see the deals behind it — a
  // salesperson should know the number they are measured against.
  const [targets, assignable] = await Promise.all([
    apiFetch<{ targets: TargetRow[]; canEdit: boolean }>('/targets', { token }).catch(() => ({
      targets: [] as TargetRow[],
      canEdit: false,
    })),
    // Served by the targets module rather than /users, which is SYSTEM_ADMIN
    // only — a sales director may set targets and may not administer accounts.
    apiFetch<{
      people: { id: string; fullNameEn: string; fullNameAr: string }[];
      units: { id: string; code: string; nameEn: string }[];
    }>('/targets/assignable', { token }).catch(() => ({ people: [], units: [] })),
  ]);

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

      <TargetSettings
        targets={targets.targets}
        canEdit={targets.canEdit}
        people={assignable.people.map((u) => ({ id: u.id, label: u.fullNameAr || u.fullNameEn }))}
        units={assignable.units.map((u) => ({ id: u.id, label: `${u.code} — ${u.nameEn}` }))}
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
