import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DataScopeService } from '../auth/data-scope.service';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * Scope, assumptions, clarifications, bids and assessments all hang off an
 * opportunity and inherit its visibility. Without a single gate, each new
 * child module would be one forgotten filter away from leaking another team's
 * pipeline — so every one of them asks here first.
 *
 * Absent-or-forbidden answers 404 alike, matching the accounts module: outside
 * your scope the record simply does not exist, and we never confirm an id.
 */
@Injectable()
export class OpportunityAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: DataScopeService,
  ) {}

  async assert(user: AuthenticatedUser, opportunityId: string) {
    const filter = await this.scope.buildFilter(user);
    const opp = await this.prisma.opportunity.findFirst({
      where: { id: opportunityId, deletedAt: null, ...filter },
      select: {
        id: true,
        code: true,
        name: true,
        stage: true,
        ownerId: true,
        // Needed to resolve which approval policy applies: limits are scoped
        // by country and business unit, per Afro Group's decision.
        country: true,
        orgUnitId: true,
        currency: true,
      },
    });
    if (!opp) throw new NotFoundException('Opportunity not found');
    return opp;
  }

  /** Same gate, reached from a child record whose parent id we already hold. */
  async assertVia(user: AuthenticatedUser, opportunityId: string | undefined | null) {
    if (!opportunityId) throw new NotFoundException('Opportunity not found');
    return this.assert(user, opportunityId);
  }
}
