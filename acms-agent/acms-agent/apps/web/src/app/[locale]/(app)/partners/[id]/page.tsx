import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api';
import { getAccessToken } from '@/lib/session';
import { money, shortDate } from '@/lib/format';
import { PartnerGovernance, type PartnerRatings } from '@/components/PartnerGovernance';

export const dynamic = 'force-dynamic';

interface PartnerDetail extends PartnerRatings {
  id: string;
  code: string;
  legalName: string;
  tradeName: string | null;
  country: string;
  city: string | null;
  taxNumber: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  approvalStatus: string;
  isBlacklisted: boolean;
  blacklistReason: string | null;
  types: { id: string; type: string }[];
  owner: { fullNameEn: string; fullNameAr: string };
  quotations: {
    id: string;
    code: string;
    totalValue: string;
    currency: string;
    validUntil: string | null;
    isSelected: boolean;
    opportunity: { id: string; code: string; name: string };
  }[];
}

export default async function PartnerDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const t = await getTranslations('partners');
  const token = await getAccessToken();

  let partner: PartnerDetail;
  try {
    partner = await apiFetch<PartnerDetail>(`/partners/${id}`, { token });
  } catch {
    notFound();
  }

  const facts = [
    { label: t('code'), value: partner.code },
    { label: t('country'), value: partner.country },
    { label: t('city'), value: partner.city ?? '—' },
    { label: t('taxNumber'), value: partner.taxNumber ?? '—' },
    { label: t('contact'), value: partner.contactName ?? '—' },
    { label: t('contactEmail'), value: partner.contactEmail ?? '—' },
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{partner.legalName}</h1>
          <p>
            {partner.code} • {partner.country} •{' '}
            {locale === 'ar' ? partner.owner.fullNameAr : partner.owner.fullNameEn}
          </p>
        </div>
        <div className="head-actions">
          {partner.isBlacklisted ? (
            <span className="badge badge-danger">{t('blacklisted')}</span>
          ) : (
            <span className="badge badge-primary">{t(partner.approvalStatus)}</span>
          )}
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

      <div style={{ marginBottom: 16 }}>
        <PartnerGovernance
          partnerId={partner.id}
          ratings={partner}
          approvalStatus={partner.approvalStatus}
          isBlacklisted={partner.isBlacklisted}
          blacklistReason={partner.blacklistReason}
          types={partner.types}
        />
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0, fontSize: 15 }}>{t('quotations')}</h2>
        <table className="data">
          <thead>
            <tr>
              <th>{t('quotationCode')}</th>
              <th>{t('opportunity')}</th>
              <th>{t('value')}</th>
              <th>{t('validUntil')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {partner.quotations.map((q) => (
              <tr key={q.id}>
                <td>{q.code}</td>
                <td>
                  <Link
                    href={`/${locale}/opportunities/${q.opportunity.id}`}
                    style={{ color: 'var(--primary)' }}
                  >
                    {q.opportunity.name}
                  </Link>
                </td>
                <td>{money(q.totalValue, q.currency)}</td>
                <td>{shortDate(q.validUntil)}</td>
                <td>
                  {q.isSelected && <span className="badge badge-success">{t('selected')}</span>}
                </td>
              </tr>
            ))}
            {partner.quotations.length === 0 && (
              <tr>
                <td colSpan={5} style={{ color: 'var(--muted)' }}>
                  {t('noQuotations')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p style={{ marginTop: 16 }}>
        <Link href={`/${locale}/partners`}>← {t('back')}</Link>
      </p>
    </>
  );
}
