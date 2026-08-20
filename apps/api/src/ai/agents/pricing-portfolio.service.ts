import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OpportunitiesService } from '../../opportunities/opportunities.service';
import type { AuthenticatedUser } from '../../auth/auth.types';

/**
 * How many opportunities one question may pull costing for. Beyond this the
 * rest are reported as unread — a distinct, stated outcome, never folded into
 * "no pricing".
 */
const MAX_OPPORTUNITIES = 40;

export type PricingState = 'priced' | 'unpriced' | 'unreadable';

export interface PricedOpportunity {
  code: string;
  name: string;
  account: string | null;
  currency: string;
  state: PricingState;
  totalCost: string | null;
  totalPrice: string | null;
  /** Margin on selling price, never on cost. Margin ≠ Markup. */
  marginPercent: string | null;
  scenario: string | null;
  versionStatus: string | null;
}

export interface PortfolioPricing {
  rows: PricedOpportunity[];
  facts: Record<string, unknown>;
}

/**
 * Costing and quotations both hang off a single opportunity, so "what do all
 * our opportunities cost" had no path through the domain services. A model
 * asked that question does not stop — it calls the single-opportunity tool
 * with no id and gets a 400 back. This is that missing path.
 *
 * Every read still runs under the asking user's own visibility: the
 * opportunity list is scoped first, and costing is only ever fetched for the
 * opportunities that list returned.
 */
@Injectable()
export class PricingPortfolioService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly opportunities: OpportunitiesService,
  ) {}

  async summarise(
    user: AuthenticatedUser,
    query: { stage?: string; status?: string; country?: string } = {},
  ): Promise<PortfolioPricing> {
    const { items } = await this.opportunities.list(user, query as never);

    const considered = items.slice(0, MAX_OPPORTUNITIES);
    const notRead = items.length - considered.length;

    const rows = await Promise.all(considered.map((opp: any) => this.priceOne(opp)));

    const byState = (state: PricingState) => rows.filter((r) => r.state === state);
    const priced = byState('priced');

    return {
      rows,
      facts: {
        // Four outcomes, four names. Collapsing any of them into a zero is how
        // "we have no pricing" gets said about data that was simply not read.
        opportunitiesConsidered: considered.length,
        priced: priced.length,
        unpriced: byState('unpriced').length,
        unreadable: byState('unreadable').length,
        notRead,
        notReadReason:
          notRead > 0
            ? `تجاوز العدد الحد (${MAX_OPPORTUNITIES}) فلم تُقرأ تكلفة ${notRead} فرصة — ضيّق السؤال بفلتر.`
            : null,
        costByCurrency: sumField(priced, 'totalCost'),
        priceByCurrency: sumField(priced, 'totalPrice'),
        // Deliberately absent rather than 0 when nothing is priced: an average
        // margin over no opportunities is not zero, it does not exist.
        marginRange: priced.length > 0 ? marginRange(priced) : null,
      },
    };
  }

  private async priceOne(opp: any): Promise<PricedOpportunity> {
    const base = {
      code: opp.code,
      name: opp.name,
      account: opp.account?.legalName ?? null,
      currency: opp.currency,
    };

    try {
      // The scenario the team actually chose, and its newest version — a draft
      // superseded by an approved one is not the number anyone means.
      const scenario = await this.prisma.costingScenario.findFirst({
        where: { opportunityId: opp.id, deletedAt: null, isSelected: true },
        include: {
          versions: {
            where: { deletedAt: null },
            orderBy: { versionNumber: 'desc' },
            take: 1,
          },
        },
      });

      const version = scenario?.versions[0];
      if (!version || version.totalPrice === null) {
        return {
          ...base,
          state: 'unpriced',
          totalCost: null,
          totalPrice: null,
          marginPercent: null,
          scenario: scenario?.name ?? null,
          versionStatus: version?.status ?? null,
        };
      }

      return {
        ...base,
        state: 'priced',
        currency: scenario!.currency,
        totalCost: version.totalCost === null ? null : String(version.totalCost),
        totalPrice: String(version.totalPrice),
        marginPercent: version.marginPercent === null ? null : String(version.marginPercent),
        scenario: scenario!.name,
        versionStatus: version.status,
      };
    } catch {
      // A read that failed is its own answer. Reporting it as "no pricing"
      // would state as fact something we never established.
      return {
        ...base,
        state: 'unreadable',
        totalCost: null,
        totalPrice: null,
        marginPercent: null,
        scenario: null,
        versionStatus: null,
      };
    }
  }
}

/** Amounts stay in their own currency — nothing here converts between them. */
function sumField(rows: PricedOpportunity[], field: 'totalCost' | 'totalPrice') {
  const totals: Record<string, number> = {};
  for (const row of rows) {
    const value = row[field];
    if (value === null) continue;
    totals[row.currency] = (totals[row.currency] ?? 0) + Number(value);
  }
  return Object.keys(totals).length > 0
    ? Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, v.toFixed(2)]))
    : null;
}

function marginRange(rows: PricedOpportunity[]) {
  const margins = rows
    .map((r) => (r.marginPercent === null ? null : Number(r.marginPercent)))
    .filter((m): m is number => m !== null);

  if (margins.length === 0) return null;
  return {
    lowest: Math.min(...margins).toFixed(2),
    highest: Math.max(...margins).toFixed(2),
    // Stated so nobody reads the range as covering every priced opportunity.
    basedOn: margins.length,
    ofPriced: rows.length,
  };
}
