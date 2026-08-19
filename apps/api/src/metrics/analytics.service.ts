import { Injectable } from '@nestjs/common';
import { STAGE_ORDER, type OpportunityStage } from '@acms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { DataScopeService } from '../auth/data-scope.service';
import type { AuthenticatedUser } from '../auth/auth.types';

export interface AnalyticsQuery {
  from?: string;
  to?: string;
  country?: string;
  stage?: string;
  industry?: string;
}

/**
 * The analytical dashboard's numbers.
 *
 * Every read goes through the same data-scope filter as the rest of the system.
 * An analytics endpoint that skipped it would be the most efficient leak in the
 * product: one call returning the shape of the whole company's book, grouped
 * and ready to read, to whoever asked.
 *
 * Filters narrow; they never widen. A filter that could reach past the caller's
 * scope is not a filter, it is a second way in.
 */
@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: DataScopeService,
  ) {}

  async overview(user: AuthenticatedUser, query: AnalyticsQuery) {
    const scopeFilter = await this.scope.buildFilter(user);

    const from = query.from ? new Date(query.from) : null;
    const to = query.to ? new Date(query.to) : null;

    const where = {
      deletedAt: null,
      ...scopeFilter,
      ...(query.country ? { country: query.country } : {}),
      ...(query.industry ? { industry: query.industry } : {}),
      ...(query.stage ? { stage: query.stage as never } : {}),
      ...(from || to
        ? {
            createdAt: {
              ...(from ? { gte: from } : {}),
              // The whole closing day, not up to midnight at its start: a range
              // that silently drops today's deals reads as a slow week.
              ...(to ? { lte: endOfDay(to) } : {}),
            },
          }
        : {}),
    };

    const opportunities = await this.prisma.opportunity.findMany({
      where,
      select: {
        id: true,
        name: true,
        stage: true,
        status: true,
        country: true,
        industry: true,
        currency: true,
        estimatedValue: true,
        proposedPrice: true,
        marginPercent: true,
        probability: true,
        createdAt: true,
        account: { select: { id: true, legalName: true } },
      },
    });

    const value = (o: { estimatedValue: unknown }) => Number(o.estimatedValue ?? 0);

    // --- by stage ------------------------------------------------------------
    // Every stage is listed, including the empty ones. A pipeline chart that
    // omits the stages nobody is in hides exactly the gap worth seeing.
    const stages = Object.keys(STAGE_ORDER) as OpportunityStage[];
    const byStage = stages
      .map((stage) => {
        const rows = opportunities.filter((o) => o.stage === stage);
        return {
          key: stage,
          order: STAGE_ORDER[stage],
          count: rows.length,
          value: round(rows.reduce((sum, o) => sum + value(o), 0)),
        };
      })
      .sort((a, b) => a.order - b.order);

    // --- by country ----------------------------------------------------------
    const byCountry = group(opportunities, (o) => o.country ?? '—', value);

    // --- by industry ---------------------------------------------------------
    const byIndustry = group(opportunities, (o) => o.industry ?? '—', value);

    // --- created / won / lost by month --------------------------------------
    const months = new Map<string, { created: number; won: number; lost: number; wonValue: number }>();
    for (const o of opportunities) {
      const key = o.createdAt.toISOString().slice(0, 7);
      const entry = months.get(key) ?? { created: 0, won: 0, lost: 0, wonValue: 0 };
      entry.created += 1;
      // CLOSED is a win here: the schema has no WON, which is exactly the
      // mistake the metrics layer carried for three releases.
      if (o.status === 'CLOSED') {
        entry.won += 1;
        entry.wonValue += value(o);
      }
      if (o.status === 'LOST') entry.lost += 1;
      months.set(key, entry);
    }
    const byMonth = [...months.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, v]) => ({ month, ...v, wonValue: round(v.wonValue) }));

    // --- customer concentration ---------------------------------------------
    // The share matters more than the ranking: "our largest customer is 46% of
    // the book" is a risk, while "Nile Telecom is first" is trivia.
    const accounts = group(
      opportunities,
      (o) => o.account?.legalName ?? '—',
      value,
    ).slice(0, 8);
    const totalValue = round(opportunities.reduce((sum, o) => sum + value(o), 0));
    const topAccounts = accounts.map((a) => ({
      ...a,
      share: totalValue > 0 ? round((a.value / totalValue) * 100) : 0,
    }));

    const won = opportunities.filter((o) => o.status === 'CLOSED');
    const lost = opportunities.filter((o) => o.status === 'LOST');
    const open = opportunities.filter((o) => o.status === 'ACTIVE' || o.status === 'ON_HOLD');

    return {
      filters: {
        from: query.from ?? null,
        to: query.to ?? null,
        country: query.country ?? null,
        industry: query.industry ?? null,
        stage: query.stage ?? null,
      },
      totals: {
        opportunities: opportunities.length,
        openValue: round(open.reduce((sum, o) => sum + value(o), 0)),
        // Weighted by the probability actually recorded on the deal. Deals with
        // none are counted at zero rather than at a flattering guess.
        weightedValue: round(
          open.reduce((sum, o) => sum + (value(o) * (o.probability ?? 0)) / 100, 0),
        ),
        wonValue: round(won.reduce((sum, o) => sum + value(o), 0)),
        won: won.length,
        lost: lost.length,
        // Null rather than zero when nothing has closed: a win rate of 0% and
        // "nothing has closed yet" are different findings.
        winRate:
          won.length + lost.length > 0
            ? round((won.length / (won.length + lost.length)) * 100)
            : null,
      },
      byStage,
      byCountry,
      byIndustry,
      byMonth,
      topAccounts,
    };
  }
}

function group<T>(
  rows: T[],
  key: (row: T) => string,
  value: (row: T) => number,
): { key: string; count: number; value: number }[] {
  const map = new Map<string, { count: number; value: number }>();
  for (const row of rows) {
    const k = key(row);
    const entry = map.get(k) ?? { count: 0, value: 0 };
    entry.count += 1;
    entry.value += value(row);
    map.set(k, entry);
  }
  return [...map.entries()]
    .map(([k, v]) => ({ key: k, count: v.count, value: round(v.value) }))
    .sort((a, b) => b.value - a.value);
}

function endOfDay(date: Date): Date {
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return end;
}

const round = (n: number) => Math.round(n * 100) / 100;
