import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api';
import { getAccessToken } from '@/lib/session';
import { BidWorkspace, type BidRow } from '@/components/BidWorkspace';

export const dynamic = 'force-dynamic';

interface Opportunity {
  id: string;
  code: string;
  name: string;
}

export default async function BidWorkspacePage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const t = await getTranslations('bidWorkspace');
  const token = await getAccessToken();

  const [opportunity, bids] = await Promise.all([
    apiFetch<Opportunity>(`/opportunities/${id}`, { token }),
    apiFetch<BidRow[]>(`/opportunities/${id}/bids`, { token }),
  ]);

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

      <BidWorkspace opportunityId={id} bids={bids} />

      <p style={{ marginTop: 16 }}>
        <Link href={`/${locale}/opportunities/${id}`}>← {t('backToOpportunity')}</Link>
      </p>
    </>
  );
}
