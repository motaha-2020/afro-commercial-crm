import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api';
import { getAccessToken } from '@/lib/session';
import { money, shortDate } from '@/lib/format';
import { LeadActions } from '@/components/LeadActions';
import { ActivityTimeline, type ActivityRow } from '@/components/ActivityTimeline';
import { LeadEditForm } from '@/components/LeadEditForm';
import { buildRefLabels, refLabel, type RefListPayload } from '@/lib/ref-labels';

export const dynamic = 'force-dynamic';

interface LeadDetail {
  id: string;
  code: string;
  name: string;
  description: string | null;
  status: string;
  source: string;
  country: string;
  industry: string | null;
  estimatedValue: string | null;
  currency: string;
  nextStep: string | null;
  disqualifyReason: string | null;
  convertedAt: string | null;
  createdAt: string;
  accountId: string | null;
  allowedTransitions: string[];
  account: { id: string; code: string; legalName: string } | null;
  contact: { id: string; fullName: string; email: string | null } | null;
  owner: { fullNameEn: string; fullNameAr: string };
  convertedOpportunity: { id: string; code: string; name: string } | null;
  activities: ActivityRow[];
}

interface AccountOption {
  id: string;
  legalName: string;
}

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const t = await getTranslations('leads');
  const token = await getAccessToken();

  let lead: LeadDetail;
  try {
    lead = await apiFetch<LeadDetail>(`/leads/${id}`, { token });
  } catch {
    notFound();
  }

  // Needed only to name the account at conversion, when the lead never had one.
  const [accounts, master] = await Promise.all([
    apiFetch<{ items: AccountOption[] }>('/accounts?pageSize=100', { token }),
    apiFetch<{
      leadSources: string[];
      industries: string[];
      currencies: string[];
      lists?: RefListPayload[];
    }>('/master-data', { token }),
  ]);

  const labels = buildRefLabels(master.lists, locale);

  const facts = [
    { label: t('code'), value: lead.code },
    { label: t('source'), value: refLabel(labels, 'LEAD_SOURCE', lead.source) },
    { label: t('country'), value: refLabel(labels, 'COUNTRY', lead.country) },
    {
      label: t('industry'),
      value: lead.industry ? refLabel(labels, 'INDUSTRY', lead.industry) : '—',
    },
    { label: t('value'), value: money(lead.estimatedValue, lead.currency) },
    { label: t('created'), value: shortDate(lead.createdAt) },
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{lead.name}</h1>
          <p>
            {lead.code} • {lead.account?.legalName ?? t('noAccount')} •{' '}
            {locale === 'ar' ? lead.owner.fullNameAr : lead.owner.fullNameEn}
          </p>
        </div>
        <div className="head-actions">
          <span className="badge badge-primary">{t(lead.status)}</span>
          {/* Renders nothing once the lead is closed — the API refuses those
              edits, and a button that only ever produces a refusal is a trap. */}
          <LeadEditForm lead={lead} master={master} labels={labels} />
        </div>
      </div>

      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        {facts.map((f) => (
          <div className="kpi" key={f.label}>
            <div className="label">{f.label}</div>
            <div className="value" style={{ fontSize: 16 }}>
              {f.value}
            </div>
          </div>
        ))}
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0, fontSize: 15 }}>{t('lifecycle')}</h2>

        {lead.convertedOpportunity && (
          <p style={{ fontSize: 13 }}>
            {t('convertedInto')}{' '}
            <Link
              href={`/${locale}/opportunities/${lead.convertedOpportunity.id}`}
              style={{ color: 'var(--primary)', fontWeight: 600 }}
            >
              {lead.convertedOpportunity.code} — {lead.convertedOpportunity.name}
            </Link>{' '}
            • {shortDate(lead.convertedAt)}
          </p>
        )}

        {lead.disqualifyReason && (
          <p style={{ fontSize: 13 }}>
            <strong>{t('disqualifyReason')}:</strong> {lead.disqualifyReason}
          </p>
        )}

        {lead.nextStep && (
          <p style={{ fontSize: 13 }}>
            <strong>{t('nextStep')}:</strong> {lead.nextStep}
          </p>
        )}

        <LeadActions
          leadId={lead.id}
          locale={locale}
          status={lead.status}
          allowedTransitions={lead.allowedTransitions}
          accountId={lead.accountId}
          accounts={accounts.items}
        />
      </div>

      {lead.description && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <h2 style={{ marginTop: 0, fontSize: 15 }}>{t('description')}</h2>
          <p style={{ fontSize: 13, margin: 0 }}>{lead.description}</p>
        </div>
      )}

      <ActivityTimeline
        activities={lead.activities}
        anchor={{ leadId: lead.id }}
        // A closed lead is a historical record; logging new work against it
        // would suggest it is still being pursued.
        readOnly={lead.allowedTransitions.length === 0}
      />

      <p style={{ marginTop: 16 }}>
        <Link href={`/${locale}/leads`}>← {t('back')}</Link>
      </p>
    </>
  );
}
