import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { isRetrospectiveActivity, type ActivityType } from '@acms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { DataScopeService } from '../auth/data-scope.service';
import { AccountAccessService } from '../common/account-access.service';
import { OpportunityAccessService } from '../common/opportunity-access.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { CreateActivityDto, ListActivitiesQuery, UpdateActivityDto } from './dto';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

@Injectable()
export class ActivitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: DataScopeService,
    private readonly accounts: AccountAccessService,
    private readonly opportunities: OpportunityAccessService,
  ) {}

  async list(user: AuthenticatedUser, query: ListActivitiesQuery) {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);

    // Asking for one parent's timeline goes through that parent's gate; asking
    // for the unfiltered list falls back to what the caller may see anywhere.
    if (query.accountId) await this.accounts.assert(user, query.accountId);
    if (query.contactId) await this.accounts.assertContact(user, query.contactId);
    if (query.opportunityId) await this.opportunities.assert(user, query.opportunityId);
    if (query.leadId) await this.assertLead(user, query.leadId);

    const anchored =
      query.accountId ?? query.contactId ?? query.opportunityId ?? query.leadId;

    const where: Prisma.ActivityWhereInput = {
      deletedAt: null,
      ...(anchored ? {} : await this.visibilityFilter(user)),
      ...(query.accountId ? { accountId: query.accountId } : {}),
      ...(query.contactId ? { contactId: query.contactId } : {}),
      ...(query.opportunityId ? { opportunityId: query.opportunityId } : {}),
      ...(query.leadId ? { leadId: query.leadId } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.openOnly ? { completedAt: null } : {}),
      ...(query.mine ? { userId: user.id } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.activity.findMany({
        where,
        // Open items sort by when they are due, done ones by when they happened;
        // one ordering that keeps overdue work at the top either way.
        orderBy: [{ completedAt: 'desc' }, { dueAt: 'asc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          user: { select: { id: true, fullNameEn: true, fullNameAr: true } },
          account: { select: { id: true, code: true, legalName: true } },
          contact: { select: { id: true, fullName: true } },
          opportunity: { select: { id: true, code: true, name: true } },
          lead: { select: { id: true, code: true, name: true } },
        },
      }),
      this.prisma.activity.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async findOne(user: AuthenticatedUser, id: string) {
    const activity = await this.prisma.activity.findFirst({
      where: { id, deletedAt: null },
      include: {
        user: { select: { id: true, fullNameEn: true, fullNameAr: true } },
        account: { select: { id: true, code: true, legalName: true } },
        contact: { select: { id: true, fullName: true } },
        opportunity: { select: { id: true, code: true, name: true } },
        lead: { select: { id: true, code: true, name: true } },
      },
    });
    if (!activity) throw new NotFoundException('Activity not found');

    await this.assertParentVisible(user, activity);
    return activity;
  }

  async create(user: AuthenticatedUser, dto: CreateActivityDto) {
    // An activity with no parent is a note nobody will ever find again.
    if (!dto.accountId && !dto.contactId && !dto.opportunityId && !dto.leadId) {
      throw new BadRequestException(
        'An activity must be linked to an account, contact, opportunity or lead',
      );
    }

    const links = await this.resolveLinks(user, dto);

    const completed = dto.completed ?? isRetrospectiveActivity(dto.type as ActivityType);

    const activity = await this.prisma.activity.create({
      data: {
        type: dto.type,
        subject: dto.subject,
        body: dto.body,
        ...links,
        userId: user.id,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined,
        completedAt: completed ? new Date() : undefined,
      },
    });

    await this.audit.record({
      entityType: 'Activity',
      entityId: activity.id,
      action: 'CREATE',
      userId: user.id,
      after: { type: activity.type, subject: activity.subject, ...links },
    });

    return activity;
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateActivityDto) {
    const existing = await this.findOne(user, id);

    const updated = await this.prisma.activity.update({
      where: { id },
      data: {
        ...dto,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined,
      },
    });

    await this.audit.recordUpdate(
      'Activity',
      id,
      existing as unknown as Record<string, unknown>,
      updated as unknown as Record<string, unknown>,
      user.id,
    );

    return updated;
  }

  async complete(user: AuthenticatedUser, id: string) {
    const existing = await this.findOne(user, id);
    if (existing.completedAt) {
      // Re-completing would move the timestamp and quietly rewrite when the
      // work actually happened.
      throw new BadRequestException('Activity is already completed');
    }

    const updated = await this.prisma.activity.update({
      where: { id },
      data: { completedAt: new Date() },
    });

    await this.audit.record({
      entityType: 'Activity',
      entityId: id,
      action: 'UPDATE',
      userId: user.id,
      after: { completedAt: updated.completedAt },
    });

    return updated;
  }

  async remove(user: AuthenticatedUser, id: string) {
    const existing = await this.findOne(user, id);

    await this.prisma.activity.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await this.audit.record({
      entityType: 'Activity',
      entityId: id,
      action: 'SOFT_DELETE',
      userId: user.id,
      before: { type: existing.type, subject: existing.subject },
    });

    return { success: true };
  }

  /**
   * Checks every link the caller supplied and fills in the ones implied by
   * them — an activity on an opportunity also belongs to that opportunity's
   * account, and saying so keeps the account timeline complete.
   */
  private async resolveLinks(user: AuthenticatedUser, dto: CreateActivityDto) {
    let accountId = dto.accountId;

    if (dto.accountId) await this.accounts.assert(user, dto.accountId);

    if (dto.contactId) {
      const contact = await this.accounts.assertContact(user, dto.contactId);
      if (dto.accountId && contact.accountId !== dto.accountId) {
        throw new BadRequestException('Contact does not belong to the named account');
      }
      accountId ??= contact.accountId;
    }

    if (dto.opportunityId) {
      await this.opportunities.assert(user, dto.opportunityId);
      const opp = await this.prisma.opportunity.findUnique({
        where: { id: dto.opportunityId },
        select: { accountId: true },
      });
      accountId ??= opp?.accountId;
    }

    if (dto.leadId) {
      const lead = await this.assertLead(user, dto.leadId);
      accountId ??= lead.accountId ?? undefined;
    }

    return {
      accountId,
      contactId: dto.contactId,
      opportunityId: dto.opportunityId,
      leadId: dto.leadId,
    };
  }

  private async assertLead(user: AuthenticatedUser, leadId: string) {
    const filter = await this.scope.buildFilter(user);
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, deletedAt: null, ...filter },
      select: { id: true, code: true, name: true, accountId: true },
    });
    if (!lead) throw new NotFoundException('Lead not found');
    return lead;
  }

  /**
   * An activity is visible if any one of its parents is. Requiring all of them
   * would hide an opportunity's own timeline from someone who can read the
   * opportunity but not the account behind it.
   */
  private async assertParentVisible(
    user: AuthenticatedUser,
    activity: { accountId: string | null; opportunityId: string | null; leadId: string | null },
  ) {
    const checks: Promise<unknown>[] = [];
    if (activity.accountId) checks.push(this.accounts.assert(user, activity.accountId));
    if (activity.opportunityId) {
      checks.push(this.opportunities.assert(user, activity.opportunityId));
    }
    if (activity.leadId) checks.push(this.assertLead(user, activity.leadId));

    const results = await Promise.allSettled(checks);
    if (!results.some((r) => r.status === 'fulfilled')) {
      throw new NotFoundException('Activity not found');
    }
  }

  /**
   * The unanchored list: everything hanging off something the caller can see.
   * Expressed as a relation filter because an activity carries no owner or org
   * unit of its own.
   */
  private async visibilityFilter(user: AuthenticatedUser): Promise<Prisma.ActivityWhereInput> {
    const filter = await this.scope.buildFilter(user);
    return {
      OR: [
        { account: { is: { deletedAt: null, ...filter } } },
        { opportunity: { is: { deletedAt: null, ...filter } } },
        { lead: { is: { deletedAt: null, ...filter } } },
        // Own entries stay visible even when their parent has since moved out
        // of scope — you can always see what you yourself logged.
        { userId: user.id },
      ],
    };
  }
}
