import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  LEAD_CONVERTIBLE_FROM,
  LEAD_STATUS_TRANSITIONS,
  canTransitionLead,
  type LeadStatus,
} from '@acms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CodeGeneratorService } from '../common/code-generator.service';
import { DataScopeService } from '../auth/data-scope.service';
import { AccountAccessService } from '../common/account-access.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type {
  ChangeLeadStatusDto,
  ConvertLeadDto,
  CreateLeadDto,
  ListLeadsQuery,
  UpdateLeadDto,
} from './dto';

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly codes: CodeGeneratorService,
    private readonly scope: DataScopeService,
    private readonly accounts: AccountAccessService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(user: AuthenticatedUser, query: ListLeadsQuery) {
    const scopeFilter = await this.scope.buildFilter(user);
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);

    const where: Prisma.LeadWhereInput = {
      deletedAt: null,
      ...scopeFilter,
      ...(query.status ? { status: query.status } : {}),
      ...(query.source ? { source: query.source } : {}),
      ...(query.country ? { country: query.country } : {}),
      ...(query.accountId ? { accountId: query.accountId } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { code: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          account: { select: { id: true, code: true, legalName: true } },
          contact: { select: { id: true, fullName: true } },
          owner: { select: { id: true, fullNameEn: true, fullNameAr: true } },
        },
      }),
      this.prisma.lead.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async findOne(user: AuthenticatedUser, id: string) {
    const scopeFilter = await this.scope.buildFilter(user);

    const lead = await this.prisma.lead.findFirst({
      where: { id, deletedAt: null, ...scopeFilter },
      include: {
        account: { select: { id: true, code: true, legalName: true } },
        contact: { select: { id: true, fullName: true, email: true, phone: true } },
        owner: { select: { id: true, fullNameEn: true, fullNameAr: true } },
        convertedOpportunity: { select: { id: true, code: true, name: true, stage: true } },
        activities: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          include: { user: { select: { id: true, fullNameEn: true, fullNameAr: true } } },
        },
      },
    });

    if (!lead) throw new NotFoundException('Lead not found');

    // The moves this lead can still make, so a caller does not have to encode
    // the transition table a second time.
    return { ...lead, allowedTransitions: LEAD_STATUS_TRANSITIONS[lead.status as LeadStatus] };
  }

  async create(user: AuthenticatedUser, dto: CreateLeadDto) {
    if (dto.accountId) await this.accounts.assert(user, dto.accountId);
    if (dto.contactId) await this.assertContactBelongsToAccount(dto.contactId, dto.accountId);

    const year = new Date().getFullYear();
    const code = await this.codes.next('LEAD', 'lead', year);

    const lead = await this.prisma.lead.create({
      data: {
        code,
        name: dto.name,
        description: dto.description,
        source: dto.source,
        country: dto.country,
        industry: dto.industry,
        estimatedValue: dto.estimatedValue,
        currency: dto.currency ?? 'USD',
        accountId: dto.accountId,
        contactId: dto.contactId,
        nextStep: dto.nextStep,
        ownerId: dto.ownerId ?? user.id,
        orgUnitId: user.orgUnitId,
        status: 'NEW',
      },
    });

    await this.audit.record({
      entityType: 'Lead',
      entityId: lead.id,
      action: 'CREATE',
      userId: user.id,
      after: { code: lead.code, name: lead.name, source: lead.source },
    });

    return lead;
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateLeadDto) {
    const existing = await this.findOne(user, id);
    this.assertLive(existing.status as LeadStatus);

    if (dto.accountId) await this.accounts.assert(user, dto.accountId);
    if (dto.contactId) {
      await this.assertContactBelongsToAccount(
        dto.contactId,
        dto.accountId ?? existing.accountId ?? undefined,
      );
    }

    const updated = await this.prisma.lead.update({ where: { id }, data: { ...dto } });

    await this.audit.recordUpdate(
      'Lead',
      id,
      existing as unknown as Record<string, unknown>,
      updated as unknown as Record<string, unknown>,
      user.id,
    );

    return updated;
  }

  async changeStatus(user: AuthenticatedUser, id: string, dto: ChangeLeadStatusDto) {
    const existing = await this.findOne(user, id);
    const from = existing.status as LeadStatus;

    // Conversion creates an opportunity and has its own endpoint; allowing it
    // here would mark a lead converted with nothing to point at.
    if (dto.status === 'CONVERTED') {
      throw new BadRequestException('Use the convert endpoint to promote a lead');
    }

    if (!canTransitionLead(from, dto.status as LeadStatus)) {
      throw new BadRequestException(
        `A ${from} lead cannot move to ${dto.status}. Allowed: ${
          LEAD_STATUS_TRANSITIONS[from].join(', ') || 'none — this status is final'
        }`,
      );
    }

    if (dto.status === 'DISQUALIFIED' && !dto.reason?.trim()) {
      throw new BadRequestException('Disqualifying a lead requires a reason');
    }

    const updated = await this.prisma.lead.update({
      where: { id },
      data: {
        status: dto.status,
        disqualifyReason: dto.status === 'DISQUALIFIED' ? dto.reason : undefined,
      },
    });

    await this.audit.record({
      entityType: 'Lead',
      entityId: id,
      action: 'UPDATE',
      userId: user.id,
      before: { status: from },
      after: { status: updated.status, reason: dto.reason ?? null },
    });

    return updated;
  }

  /**
   * Promotes a qualified lead into an opportunity. The lead is not consumed:
   * it stays as its own row pointing at what it became, so "where did this
   * pipeline come from?" stays answerable a year later.
   */
  async convert(user: AuthenticatedUser, id: string, dto: ConvertLeadDto) {
    const lead = await this.findOne(user, id);
    const from = lead.status as LeadStatus;

    if (from !== LEAD_CONVERTIBLE_FROM) {
      throw new BadRequestException(
        `Only a ${LEAD_CONVERTIBLE_FROM} lead converts; this one is ${from}`,
      );
    }
    if (lead.convertedOpportunityId) {
      throw new ConflictException('Lead has already been converted');
    }

    const accountId = dto.accountId ?? lead.accountId;
    if (!accountId) {
      throw new BadRequestException(
        'The lead names no account; supply one to convert it',
      );
    }
    await this.accounts.assert(user, accountId);

    const year = new Date().getFullYear();
    const code = await this.codes.next('OPP', 'opportunity', year);

    const { opportunity, updatedLead } = await this.prisma.$transaction(async (tx) => {
      const opportunity = await tx.opportunity.create({
        data: {
          code,
          name: dto.opportunityName ?? lead.name,
          description: lead.description,
          accountId,
          primaryContactId: lead.contactId,
          country: lead.country,
          industry: lead.industry,
          source: lead.source,
          currency: lead.currency,
          estimatedValue: dto.estimatedValue ?? lead.estimatedValue,
          ownerId: lead.ownerId,
          orgUnitId: lead.orgUnitId,
          // A converted lead enters at qualification, not intake: qualifying it
          // is exactly the work that has just been done.
          stage: 'LEAD_QUALIFICATION',
          status: 'ACTIVE',
          forecastCategory: 'PIPELINE',
          health: 'GREEN',
        },
      });

      await tx.opportunityStageHistory.create({
        data: {
          opportunityId: opportunity.id,
          fromStage: null,
          toStage: 'LEAD_QUALIFICATION',
          changedById: user.id,
          reason: `Converted from lead ${lead.code}`,
        },
      });

      const updatedLead = await tx.lead.update({
        where: { id },
        data: {
          status: 'CONVERTED',
          convertedOpportunityId: opportunity.id,
          convertedAt: new Date(),
          accountId,
        },
      });

      // Activities logged against the lead follow it into the opportunity, or
      // the conversation history stops dead at the moment it got interesting.
      await tx.activity.updateMany({
        where: { leadId: id, deletedAt: null },
        data: { opportunityId: opportunity.id, accountId },
      });

      return { opportunity, updatedLead };
    });

    await this.audit.record({
      entityType: 'Lead',
      entityId: id,
      action: 'UPDATE',
      userId: user.id,
      before: { status: from },
      after: { status: 'CONVERTED', opportunityId: opportunity.id, opportunityCode: opportunity.code },
    });

    await this.audit.record({
      entityType: 'Opportunity',
      entityId: opportunity.id,
      action: 'CREATE',
      userId: user.id,
      after: { code: opportunity.code, name: opportunity.name, fromLead: lead.code },
    });

    await this.notifications.dispatchEvent('LEAD_CONVERTED', {
      title: `Lead converted: ${lead.name}`,
      body: `${lead.code} → ${opportunity.code}`,
      entityType: 'Opportunity',
      entityId: opportunity.id,
    });

    return { lead: updatedLead, opportunity };
  }

  async remove(user: AuthenticatedUser, id: string) {
    const existing = await this.findOne(user, id);

    if (existing.convertedOpportunityId) {
      throw new BadRequestException(
        'A converted lead is the origin record of a live opportunity and cannot be removed',
      );
    }

    await this.prisma.lead.update({ where: { id }, data: { deletedAt: new Date() } });

    await this.audit.record({
      entityType: 'Lead',
      entityId: id,
      action: 'SOFT_DELETE',
      userId: user.id,
      before: { code: existing.code, name: existing.name },
    });

    return { success: true };
  }

  private assertLive(status: LeadStatus) {
    if (LEAD_STATUS_TRANSITIONS[status].length === 0) {
      throw new BadRequestException(`A ${status} lead is closed and cannot be edited`);
    }
  }

  private async assertContactBelongsToAccount(contactId: string, accountId?: string) {
    const contact = await this.prisma.contact.findFirst({
      where: { id: contactId, deletedAt: null },
      select: { accountId: true },
    });
    if (!contact) throw new NotFoundException('Contact not found');

    // Pairing a contact with the wrong company is how a lead ends up addressed
    // to someone who never worked there.
    if (accountId && contact.accountId !== accountId) {
      throw new BadRequestException('Contact does not belong to the named account');
    }
  }
}
