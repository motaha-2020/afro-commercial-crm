import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api';
import { getAccessToken } from '@/lib/session';
import { money } from '@/lib/format';
import {
  ProposalsPanel,
  type BidOption,
  type CostingOption,
  type ProposalRow,
} from '@/components/ProposalsPanel';

export const dynamic = 'force-dynamic';

interface Opportunity {
  id: string;
  code: string;
  name: string;
}

interface CostingScenario {
  id: string;
  name: string;
  currency: string;
  versions: {
    id: string;
    versionNumber: number;
    status: string;
    totalPrice: string | null;
  }[];
}

interface Bid {
  id: string;
  code: string;
  tenderNumber: string | null;
}

export default async function ProposalsPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const t = await getTranslations('proposals');
  const token = await getAccessToken();

  const [opportunity, proposals, scenarios, bids] = await Promise.all([
    apiFetch<Opportunity>(`/opportunities/${id}`, { token }),
    apiFetch<ProposalRow[]>(`/opportunities/${id}/proposals`, { token }).catch(
      () => [] as ProposalRow[],
    ),
    apiFetch<CostingScenario[]>(`/opportunities/${id}/costing`, { token }).catch(
      () => [] as CostingScenario[],
    ),
    apiFetch<Bid[]>(`/opportunities/${id}/bids`, { token }).catch(() => [] as Bid[]),
  ]);

  // Only approved costings are offered. A draft is a number still being worked
  // out, and the API refuses to quote one — listing them here would put choices
  // in the form whose only possible outcome is a rejection.
  const costingOptions: CostingOption[] = scenarios.flatMap((s) =>
    s.versions
      .filter((v) => v.status === 'APPROVED')
      .map((v) => ({
        id: v.id,
        label: `${s.name} · v${v.versionNumber} — ${
          v.totalPrice ? money(Number(v.totalPrice), s.currency) : '—'
        }`,
        totalPrice: v.totalPrice,
        currency: s.currency,
      })),
  );

  const bidOptions: BidOption[] = bids.map((b) => ({
    id: b.id,
    label: b.tenderNumber ? `${b.code} · ${b.tenderNumber}` : b.code,
  }));

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

      <ProposalsPanel
        opportunityId={id}
        proposals={proposals}
        costingOptions={costingOptions}
        bids={bidOptions}
      />

      <p style={{ marginTop: 16 }}>
        <Link href={`/${locale}/opportunities/${id}`}>← {t('backToOpportunity')}</Link>
      </p>
    </>
  );
}
