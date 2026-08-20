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
  /**
   * Which currency the money on this screen is in.
   *
   * Every chart here compares amounts, and amounts in different currencies do
   * not compare -- a bar of 20,000,000 EGP beside one of 8,465,000 USD says
   * the first is larger, which is not a fact about the pipeline. So the screen
   * answers in one currency at a time, and says which.
   */
  currency?: string;
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

    // Every currency present, so the screen can offer the choice and say what
    // it is leaving out rather than silently answering for one of them.
    const currencies = [...new Set(opportunities.map((o) => o.currency))].sort();

    // Default to whichever currency carries the most records, so the common
    // single-currency case needs no choice made at all.
    const chosen =
      query.currency && currencies.includes(query.currency)
        ? query.currency
        : (currencies
            .map((c) => ({ c, n: opportunities.filter((o) => o.currency === c).length }))
            .sort((a, b) => b.n - a.n)[0]?.c ?? null);

    // Money is counted only within the chosen currency. Counts are not money
    // and stay across all of them -- "how many deals" has one true answer.
    const inCurrency = chosen ? opportunities.filter((o) => o.currency === chosen) : [];

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
          // Deals are counted across every currency; money is not.
          count: rows.length,
          value: round(
            inCurrency.filter((o) => o.stage === stage).reduce((sum, o) => sum + value(o), 0),
          ),
        };
      })
      .sort((a, b) => a.order - b.order);

    // --- by country ----------------------------------------------------------
    const byCountry = group(inCurrency, (o) => o.country ?? '—', value);

    // --- by industry ---------------------------------------------------------
    const byIndustry = group(inCurrency, (o) => o.industry ?? '—', value);

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
        // Counted only when it is in the currency this screen is answering in.
        if (o.currency === chosen) entry.wonValue += value(o);
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
      inCurrency,
      (o) => o.account?.legalName ?? '—',
      value,
    ).slice(0, 8);
    // The denominator is the same currency as the numerators, or the share is
    // a percentage of a number that is not money.
    const totalValue = round(inCurrency.reduce((sum, o) => sum + value(o), 0));
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
        currency: chosen,
      },
      // What the reader may switch to, and what is therefore not on screen.
      currencies,
      currency: chosen,
      totals: {
        opportunities: opportunities.length,
        // How many of the records above the money actually covers, so a book
        // that is mostly in another currency cannot read as a quiet quarter.
        opportunitiesInCurrency: inCurrency.length,
        openValue: round(
          open.filter((o) => o.currency === chosen).reduce((sum, o) => sum + value(o), 0),
        ),
        // Weighted by the probability actually recorded on the deal. Deals with
        // none are counted at zero rather than at a flattering guess.
        weightedValue: round(
          open
            .filter((o) => o.currency === chosen)
            .reduce((sum, o) => sum + (value(o) * (o.probability ?? 0)) / 100, 0),
        ),
        wonValue: round(
          won.filter((o) => o.currency === chosen).reduce((sum, o) => sum + value(o), 0),
        ),
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
