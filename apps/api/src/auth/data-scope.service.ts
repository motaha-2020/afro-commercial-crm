import { Injectable } from '@nestjs/common';
import { DATA_SCOPE_RANK, type DataScope } from '@acms/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from './auth.types';

/**
 * Translates a user's role scopes into a Prisma `where` fragment.
 *
 * The spec defines six widening levels of record visibility. A user holding
 * several roles gets the WIDEST scope any of them grants — a Finance lead who
 * is also an Account Manager should not lose country-wide sight of the pipeline
 * because one of their roles is narrow.
 */
@Injectable()
export class DataScopeService {
  constructor(private readonly prisma: PrismaService) {}

  effectiveScope(user: AuthenticatedUser): DataScope {
    return user.roles.reduce<DataScope>(
      (widest, r) =>
        DATA_SCOPE_RANK[r.scope as DataScope] > DATA_SCOPE_RANK[widest]
          ? (r.scope as DataScope)
          : widest,
      'OWN',
    );
  }

  /**
   * Builds the visibility filter for records that carry `ownerId` and
   * `orgUnitId`. Callers spread the result into their own `where` clause.
   */
  async buildFilter(user: AuthenticatedUser): Promise<Record<string, unknown>> {
    const scope = this.effectiveScope(user);

    switch (scope) {
      case 'GROUP':
        return {};

      case 'OWN':
        return { ownerId: user.id };

      case 'TEAM': {
        // Direct reports plus self. Deliberately one level deep: a manager sees
        // their team, not the whole sub-tree beneath them.
        const reports = await this.prisma.user.findMany({
          where: { managerId: user.id, deletedAt: null },
          select: { id: true },
        });
        return { ownerId: { in: [user.id, ...reports.map((r) => r.id)] } };
      }

      case 'BUSINESS_UNIT':
      case 'LEGAL_ENTITY': {
        const unitIds = await this.descendantUnitIds(user.orgUnitId);
        return { orgUnitId: { in: unitIds } };
      }

      case 'COUNTRY': {
        const unit = await this.prisma.organizationUnit.findUnique({
          where: { id: user.orgUnitId },
          select: { country: true },
        });
        // A unit with no country recorded would otherwise match every record
        // whose country is also null, so fall back to the user's own records.
        if (!unit?.country) return { ownerId: user.id };
        return { country: unit.country };
      }

      default: {
        const exhaustive: never = scope;
        throw new Error(`Unhandled data scope: ${String(exhaustive)}`);
      }
    }
  }

  /**
   * Walks the org tree downward from `rootId`. Iterative rather than recursive
   * so that a cycle introduced by bad master data cannot blow the stack; the
   * `seen` set makes such a cycle terminate instead of hanging.
   */
  private async descendantUnitIds(rootId: string): Promise<string[]> {
    const seen = new Set<string>([rootId]);
    let frontier = [rootId];

    while (frontier.length > 0) {
      const children = await this.prisma.organizationUnit.findMany({
        where: { parentId: { in: frontier }, deletedAt: null },
        select: { id: true },
      });

      frontier = children.map((c) => c.id).filter((id) => !seen.has(id));
      frontier.forEach((id) => seen.add(id));
    }

    return [...seen];
  }
}
