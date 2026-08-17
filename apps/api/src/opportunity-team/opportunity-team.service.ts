import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OpportunityAccessService } from '../common/opportunity-access.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { AddTeamMemberDto, UpdateTeamMemberDto } from './dto';

const MEMBER_CARD = {
  id: true,
  email: true,
  fullNameAr: true,
  fullNameEn: true,
  jobTitle: true,
  isActive: true,
} as const;

@Injectable()
export class OpportunityTeamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly opportunities: OpportunityAccessService,
  ) {}

  async list(user: AuthenticatedUser, opportunityId: string) {
    await this.opportunities.assert(user, opportunityId);

    const items = await this.prisma.opportunityTeam.findMany({
      where: { opportunityId, deletedAt: null },
      // Lead first: on a bid with eight names it is the one being looked for.
      orderBy: [{ isLead: 'desc' }, { createdAt: 'asc' }],
      include: { user: { select: MEMBER_CARD } },
    });

    return {
      items,
      total: items.length,
      /**
       * Said out loud rather than left to be counted. A bid with nobody named
       * as lead and a bid whose lead simply is not shown look identical on a
       * screen, and only one of them is a problem.
       */
      hasLead: items.some((m) => m.isLead),
    };
  }

  /**
   * Who may be put on this bid, with the roles each of them holds.
   *
   * A separate, deliberately thin endpoint rather than reusing `/users`: that
   * one is SYSTEM_ADMIN only, and rightly so — it carries email addresses,
   * login times, org units and the must-change-password flag. Staffing a bid
   * needs none of that, so this returns names and granted roles and nothing
   * else, behind the opportunity's own visibility gate.
   *
   * The roles travel with each person so the screen can offer only the ones
   * they actually hold. Offering a choice that `add` can only refuse is how a
   * form teaches people to ignore it.
   */
  async candidates(user: AuthenticatedUser, opportunityId: string) {
    await this.opportunities.assert(user, opportunityId);

    const items = await this.prisma.user.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: { fullNameEn: 'asc' },
      select: {
        id: true,
        fullNameAr: true,
        fullNameEn: true,
        jobTitle: true,
        isActive: true,
        roles: { select: { role: true } },
      },
    });

    return { items, total: items.length };
  }

  async add(user: AuthenticatedUser, opportunityId: string, dto: AddTeamMemberDto) {
    await this.opportunities.assert(user, opportunityId);

    const member = await this.prisma.user.findFirst({
      // Soft-deleted counts as absent everywhere else in the system, and a
      // removed account is not a colleague who can be given work.
      where: { id: dto.userId, deletedAt: null },
      select: { ...MEMBER_CARD, roles: { select: { role: true } } },
    });
    if (!member) throw new NotFoundException('User not found');

    // Someone who has left the company staffs the team on paper and nowhere
    // else. A bid that looks covered is worse than one visibly short-handed.
    if (!member.isActive) {
      throw new BadRequestException('User is deactivated and cannot be added to a bid team');
    }

    // The team is a record of who is answerable for what. Naming somebody as
    // FINANCE on the bid when the system has never granted them the finance
    // role produces a line that reads as a control and is not one — and the
    // approval routing they appear to cover would still go elsewhere.
    if (!member.roles.some((r) => r.role === dto.role)) {
      throw new BadRequestException(
        `User does not hold the ${dto.role} role; grant it first or add them under a role they hold`,
      );
    }

    const created = await this.prisma.$transaction(async (tx) => {
      if (dto.isLead) await this.demoteExistingLead(tx, opportunityId);

      // Removing a member leaves a soft-deleted row still holding the unique
      // triple, so adding them back revives that row instead of colliding.
      return tx.opportunityTeam.upsert({
        where: {
          opportunityId_userId_role: {
            opportunityId,
            userId: dto.userId,
            role: dto.role,
          },
        },
        create: {
          opportunityId,
          userId: dto.userId,
          role: dto.role,
          isLead: dto.isLead ?? false,
        },
        update: { deletedAt: null, isLead: dto.isLead ?? false },
        include: { user: { select: MEMBER_CARD } },
      });
    });

    await this.audit.record({
      entityType: 'OpportunityTeam',
      entityId: created.id,
      action: 'CREATE',
      userId: user.id,
      after: {
        opportunityId,
        userId: dto.userId,
        role: dto.role,
        isLead: created.isLead,
      },
    });

    return created;
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateTeamMemberDto) {
    const existing = await this.findAccessible(user, id);

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.isLead && !existing.isLead) {
        await this.demoteExistingLead(tx, existing.opportunityId);
      }
      return tx.opportunityTeam.update({
        where: { id },
        data: { isLead: dto.isLead },
        include: { user: { select: MEMBER_CARD } },
      });
    });

    await this.audit.recordUpdate(
      'OpportunityTeam',
      id,
      { isLead: existing.isLead },
      { isLead: updated.isLead },
      user.id,
    );

    return updated;
  }

  async remove(user: AuthenticatedUser, id: string) {
    const existing = await this.findAccessible(user, id);

    await this.prisma.opportunityTeam.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await this.audit.record({
      entityType: 'OpportunityTeam',
      entityId: id,
      action: 'SOFT_DELETE',
      userId: user.id,
      before: {
        opportunityId: existing.opportunityId,
        userId: existing.userId,
        role: existing.role,
        wasLead: existing.isLead,
      },
    });

    return { success: true };
  }

  private async findAccessible(user: AuthenticatedUser, id: string) {
    const row = await this.prisma.opportunityTeam.findFirst({
      where: { id, deletedAt: null },
    });
    if (!row) throw new NotFoundException('Team member not found');
    await this.opportunities.assert(user, row.opportunityId);
    return row;
  }

  /**
   * "Lead" is a claim about the bid, not about the person, so it can only be
   * true once. Promoting one steps the incumbent down inside the same
   * transaction rather than leaving two rows both claiming it — the same rule,
   * for the same reason, as the primary contact on an account.
   */
  private async demoteExistingLead(tx: Prisma.TransactionClient, opportunityId: string) {
    await tx.opportunityTeam.updateMany({
      where: { opportunityId, isLead: true, deletedAt: null },
      data: { isLead: false },
    });
  }
}
