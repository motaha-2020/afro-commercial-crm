import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api';
import { getAccessToken } from '@/lib/session';
import { money } from '@/lib/format';
import { ContactsPanel, type ContactRow } from '@/components/ContactsPanel';
import { ActivityTimeline, type ActivityRow } from '@/components/ActivityTimeline';
import { DocumentsPanel, type DocumentRow } from '@/components/DocumentsPanel';
import { AccountEditForm } from '@/components/AccountEditForm';
import { buildRefLabels, type RefListPayload } from '@/lib/ref-labels';

export const dynamic = 'force-dynamic';

interface Account360 {
  id: string;
  code: string;
  legalName: string;
  tradeName: string | null;
  type: string;
  industry: string | null;
  country: string;
  city: string | null;
  address: string | null;
  website: string | null;
  taxId: string | null;
  creditStatus: string;
  paymentTermDays: number | null;
  owner: { fullNameEn: string; fullNameAr: string };
  contacts: ContactRow[];
  opportunities: {
    id: string;
    code: string;
    name: string;
    stage: string;
    health: string;
    estimatedValue: string | null;
    currency: string;
  }[];
}

export default async function AccountDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const t = await getTranslations('accounts');
  const stageT = await getTranslations('stage');
  const healthT = await getTranslations('health');
  const typeT = await getTranslations('accountType');
  const countryT = await getTranslations('country');
  const creditT = await getTranslations('creditStatus');
  const industryT = await getTranslations('industry');
  const token = await getAccessToken();

  let account: Account360;
  try {
    account = await apiFetch<Account360>(`/accounts/${id}`, { token });
  } catch {
    notFound();
  }

  // The 360 payload deliberately stops short of the timeline: it is the one
  // part that grows without limit, so it is paged on its own endpoint.
  const activities = await apiFetch<{ items: ActivityRow[] }>(
    `/activities?accountId=${id}&pageSize=50`,
    { token },
  );

  const master = await apiFetch<{
    accountTypes: string[];
    industries: string[];
    lists?: RefListPayload[];
  }>('/master-data', { token });
  const labels = buildRefLabels(master.lists, locale);

  const documents = await apiFetch<DocumentRow[]>(
    `/documents?entityType=Account&entityId=${id}`,
    { token },
  ).catch(() => [] as DocumentRow[]);

  const facts = [
    { label: t('code'), value: account.code },
    // Codes are stored as codes and translated at the display layer — the
    // whole reason the app keeps them apart.
    { label: t('type'), value: typeT(account.type) },
    { label: t('country'), value: countryT(account.country) },
    { label: t('industry'), value: account.industry ? industryT(account.industry) : '—' },
    { label: t('creditStatus'), value: creditT(account.creditStatus) },
    { label: t('paymentTerms'), value: account.paymentTermDays ? `${account.paymentTermDays} ${t('days')}` : '—' },
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{account.legalName}</h1>
          <p>
            {account.code} • {account.country} •{' '}
            {locale === 'ar' ? account.owner.fullNameAr : account.owner.fullNameEn}
          </p>
        </div>
        <div className="head-actions">
          <span className="badge badge-primary">Account 360°</span>
          {/* Credit standing is not on this form: SoD rule 5 keeps it out of
              the hands that created the customer, and the API refuses it. */}
          <AccountEditForm account={account} master={master} labels={labels} />
        </div>
      </div>

      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        {facts.map((f) => (
          <div className="kpi" key={f.label}>
            <div className="label">{f.label}</div>
            <div className="value" style={{ fontSize: 16 }}>{f.value}</div>
          </div>
        ))}
      </div>

      <div style={{ marginBottom: 16 }}>
        <ContactsPanel accountId={account.id} contacts={account.contacts} />
      </div>

      <div className="grid cols-2">
        <div className="panel">
          <h2 style={{ marginTop: 0, fontSize: 15 }}>{t('opportunities')}</h2>
          <table className="data">
            <thead>
              <tr>
                <th>{t('name')}</th>
                <th>{t('stage')}</th>
                <th>{t('health')}</th>
                <th>{t('value')}</th>
              </tr>
            </thead>
            <tbody>
              {account.opportunities.map((o) => (
                <tr key={o.id}>
                  <td>{o.name}</td>
                  <td>{stageT(o.stage)}</td>
                  <td><span className={`badge health-${o.health}`}>{healthT(o.health)}</span></td>
                  <td>{money(o.estimatedValue, o.currency)}</td>
                </tr>
              ))}
              {account.opportunities.length === 0 && (
                <tr><td colSpan={4} style={{ color: 'var(--muted)' }}>{t('noOpportunities')}</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <ActivityTimeline activities={activities.items} anchor={{ accountId: account.id }} />
      </div>

      <div style={{ marginTop: 16 }}>
        <DocumentsPanel entityType="Account" entityId={account.id} documents={documents} />
      </div>
    </>
  );
}
