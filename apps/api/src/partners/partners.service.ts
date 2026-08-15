import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, Role } from '@prisma/client';
import { PARTNER_RATING_DIMENSIONS } from '@acms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CodeGeneratorService } from '../common/code-generator.service';
import { DataScopeService } from '../auth/data-scope.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type {
  AddPartnerTypeDto,
  BlacklistPartnerDto,
  ChangeApprovalStatusDto,
  CreatePartnerDto,
  ListPartnersQuery,
  RatePartnerDto,
  UpdatePartnerDto,
} from './dto';

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

/**
 * Approving a partner and blacklisting one are procurement and finance
 * decisions, not something the account manager who found them can grant
 * themselves.
 */
const PARTNER_AUTHORITY: Role[] = [
  'PROCUREMENT',
  'FINANCE',
  'CEO',
  'OWNER_BOARD',
  'SALES_DIRECTOR',
];

@Injectable()
export class PartnersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly codes: CodeGeneratorService,
    private readonly scope: DataScopeService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(user: AuthenticatedUser, query: ListPartnersQuery) {
    const scopeFilter = await this.scope.buildFilter(user);
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);

    const where: Prisma.BusinessPartnerWhereInput = {
      deletedAt: null,
      ...scopeFilter,
      ...(query.country ? { country: query.country } : {}),
      ...(query.approvalStatus ? { approvalStatus: query.approvalStatus } : {}),
      ...(query.type
        ? { types: { some: { type: query.type, deletedAt: null } } }
        : {}),
      ...(query.eligibleOnly === 'true'
        ? { isBlacklisted: false, approvalStatus: { in: ['APPROVED', 'CONDITIONAL'] } }
        : {}),
      ...(query.search
        ? {
            OR: [
              { legalName: { contains: query.search, mode: 'insensitive' } },
              { tradeName: { contains: query.search, mode: 'insensitive' } },
              { code: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.businessPartner.findMany({
        where,
        orderBy: { legalName: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          types: { where: { deletedAt: null } },
          owner: { select: { id: true, fullNameEn: true, fullNameAr: true } },
          _count: { select: { quotations: true } },
          // Removal is refused for a partner whose quotation was chosen. The
          // list carries that fact so the screen can leave the button out
          // instead of offering one that can only ever produce a refusal.
          quotations: {
            where: { isSelected: true, deletedAt: null },
            select: { id: true },
            take: 1,
          },
        },
      }),
      this.prisma.businessPartner.count({ where }),
    ]);

    return {
      items: rows.map(({ quotations, ...p }) => ({
        ...this.withDerivedRating(p),
        hasSelectedQuotation: quotations.length > 0,
      })),
      total,
      page,
      pageSize,
    };
  }

  async findOne(user: AuthenticatedUser, id: string) {
    const scopeFilter = await this.scope.buildFilter(user);

    const partner = await this.prisma.businessPartner.findFirst({
      where: { id, deletedAt: null, ...scopeFilter },
      include: {
        types: { where: { deletedAt: null } },
        owner: { select: { id: true, fullNameEn: true, fullNameAr: true } },
        quotations: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 25,
          select: {
            id: true,
            code: true,
            quotationNumber: true,
            totalValue: true,
            currency: true,
            validUntil: true,
            isSelected: true,
            technicalStatus: true,
            commercialStatus: true,
            opportunity: { select: { id: true, code: true, name: true } },
          },
        },
      },
    });

    if (!partner) throw new NotFoundException('Partner not found');
    return this.withDerivedRating(partner);
  }

  async create(user: AuthenticatedUser, dto: CreatePartnerDto) {
    const year = new Date().getFullYear();
    const code = await this.codes.next('PTR', 'partner', year);

    const partner = await this.prisma.businessPartner.create({
      data: {
        code,
        legalName: dto.legalName,
        tradeName: dto.tradeName,
        country: dto.country,
        city: dto.city,
        address: dto.address,
        taxNumber: dto.taxNumber,
        website: dto.website,
        contactName: dto.contactName,
        contactEmail: dto.contactEmail,
        contactPhone: dto.contactPhone,
        notes: dto.notes,
        ownerId: dto.ownerId ?? user.id,
        orgUnitId: user.orgUnitId,
        // A new partner starts as a prospect. Nobody creates an approved one:
        // approval is a separate act by a separate authority.
        approvalStatus: 'PROSPECT',
        types: dto.types?.length
          ? { create: [...new Set(dto.types)].map((type) => ({ type })) }
          : undefined,
      },
      include: { types: { where: { deletedAt: null } } },
    });

    await this.audit.record({
      entityType: 'BusinessPartner',
      entityId: partner.id,
      action: 'CREATE',
      userId: user.id,
      after: { code: partner.code, legalName: partner.legalName, types: dto.types ?? [] },
    });

    return this.withDerivedRating(partner);
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdatePartnerDto) {
    const existing = await this.findOne(user, id);

    const updated = await this.prisma.businessPartner.update({
      where: { id },
      data: { ...dto },
      include: { types: { where: { deletedAt: null } } },
    });

    await this.audit.recordUpdate(
      'BusinessPartner',
      id,
      existing as unknown as Record<string, unknown>,
      updated as unknown as Record<string, unknown>,
      user.id,
    );

    return this.withDerivedRating(updated);
  }

  async rate(user: AuthenticatedUser, id: string, dto: RatePartnerDto) {
    const existing = await this.findOne(user, id);

    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('Supply at least one rating');
    }

    const updated = await this.prisma.businessPartner.update({
      where: { id },
      data: { ...dto },
      include: { types: { where: { deletedAt: null } } },
    });

    await this.audit.recordUpdate(
      'BusinessPartner',
      id,
      existing as unknown as Record<string, unknown>,
      updated as unknown as Record<string, unknown>,
      user.id,
    );

    return this.withDerivedRating(updated);
  }

  async changeApproval(user: AuthenticatedUser, id: string, dto: ChangeApprovalStatusDto) {
    const existing = await this.findOne(user, id);
    this.assertAuthority(user, 'approve a partner');

    if (dto.approvalStatus === 'APPROVED' && existing.isBlacklisted) {
      throw new BadRequestException(
        'A blacklisted partner cannot be approved; lift the blacklisting first',
      );
    }

    const updated = await this.prisma.businessPartner.update({
      where: { id },
      data: { approvalStatus: dto.approvalStatus },
      include: { types: { where: { deletedAt: null } } },
    });

    await this.audit.record({
      entityType: 'BusinessPartner',
      entityId: id,
      action: 'STATUS_CHANGE',
      userId: user.id,
      before: { approvalStatus: existing.approvalStatus },
      after: { approvalStatus: updated.approvalStatus, reason: dto.reason ?? null },
    });

    await this.notifications.dispatchEvent('PARTNER_STATUS_CHANGED', {
      title: `Partner status changed: ${updated.legalName}`,
      body: `${existing.approvalStatus} → ${updated.approvalStatus}`,
      entityType: 'BusinessPartner',
      entityId: id,
    });

    return this.withDerivedRating(updated);
  }

  /**
   * Blacklisting is a hard gate rather than a label — the selection endpoint
   * refuses a blacklisted partner outright — so it needs a stated reason and
   * the authority to impose one.
   */
  async setBlacklist(user: AuthenticatedUser, id: string, dto: BlacklistPartnerDto) {
    const existing = await this.findOne(user, id);
    this.assertAuthority(user, 'blacklist a partner');

    if (dto.isBlacklisted && !dto.reason?.trim()) {
      throw new BadRequestException('Blacklisting a partner requires a reason');
    }

    const updated = await this.prisma.businessPartner.update({
      where: { id },
      data: {
        isBlacklisted: dto.isBlacklisted,
        blacklistReason: dto.isBlacklisted ? dto.reason : null,
        blacklistedAt: dto.isBlacklisted ? new Date() : null,
        // Blacklisting withdraws approval in the same act, or an approved
        // blacklisted partner would still read as usable in half the screens.
        approvalStatus: dto.isBlacklisted ? 'SUSPENDED' : existing.approvalStatus,
      },
      include: { types: { where: { deletedAt: null } } },
    });

    await this.audit.record({
      entityType: 'BusinessPartner',
      entityId: id,
      action: 'STATUS_CHANGE',
      userId: user.id,
      before: { isBlacklisted: existing.isBlacklisted },
      after: { isBlacklisted: updated.isBlacklisted, reason: dto.reason ?? null },
    });

    await this.notifications.dispatchEvent('PARTNER_BLACKLISTED', {
      title: `Partner ${dto.isBlacklisted ? 'blacklisted' : 'reinstated'}: ${updated.legalName}`,
      body: dto.reason,
      entityType: 'BusinessPartner',
      entityId: id,
    });

    return this.withDerivedRating(updated);
  }

  async addType(user: AuthenticatedUser, id: string, dto: AddPartnerTypeDto) {
    await this.findOne(user, id);

    // A type removed earlier left a soft-deleted row holding the unique pair,
    // so granting it again revives that row instead of failing on a duplicate.
    const assignment = await this.prisma.partnerTypeAssignment.upsert({
      where: { partnerId_type: { partnerId: id, type: dto.type } },
      create: { partnerId: id, type: dto.type, notes: dto.notes },
      update: { deletedAt: null, notes: dto.notes },
    });

    await this.audit.record({
      entityType: 'BusinessPartner',
      entityId: id,
      action: 'UPDATE',
      userId: user.id,
      after: { addedType: dto.type },
    });

    return assignment;
  }

  async removeType(user: AuthenticatedUser, id: string, type: string) {
    await this.findOne(user, id);

    const assignment = await this.prisma.partnerTypeAssignment.findFirst({
      where: { partnerId: id, type: type as never, deletedAt: null },
    });
    if (!assignment) throw new NotFoundException('Partner type not found');

    await this.prisma.partnerTypeAssignment.update({
      where: { id: assignment.id },
      data: { deletedAt: new Date() },
    });

    await this.audit.record({
      entityType: 'BusinessPartner',
      entityId: id,
      action: 'UPDATE',
      userId: user.id,
      before: { removedType: type },
    });

    return { success: true };
  }

  async remove(user: AuthenticatedUser, id: string) {
    const existing = await this.findOne(user, id);

    // A partner whose quotation was chosen is part of a priced bid; removing
    // them would leave that price pointing at nobody.
    const selected = await this.prisma.partnerQuotation.count({
      where: { partnerId: id, isSelected: true, deletedAt: null },
    });
    if (selected > 0) {
      throw new BadRequestException(
        'Partner has a selected quotation and cannot be removed; blacklist them instead',
      );
    }

    await this.prisma.businessPartner.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await this.audit.record({
      entityType: 'BusinessPartner',
      entityId: id,
      action: 'SOFT_DELETE',
      userId: user.id,
      before: { code: existing.code, legalName: existing.legalName },
    });

    return { success: true };
  }

  private assertAuthority(user: AuthenticatedUser, action: string) {
    if (!user.roles.some((r) => PARTNER_AUTHORITY.includes(r.role))) {
      throw new ForbiddenException(
        `Only procurement, finance or executive management may ${action}`,
      );
    }
  }

  /**
   * The overall rating is DERIVED on read and never stored.
   *
   * The spec lists an "Overall Rating" field, but persisting it would let it
   * drift from the four parts it claims to summarise. Computed here it is
   * always exactly the mean of the dimensions that have been scored — and the
   * response carries how many of the four that was, so a single strong reading
   * cannot masquerade as a full assessment.
   */
  private withDerivedRating<
    T extends {
      technicalRating: number | null;
      commercialRating: number | null;
      financialRating: number | null;
      hseRating: number | null;
    },
  >(partner: T) {
    const scored = [
      partner.technicalRating,
      partner.commercialRating,
      partner.financialRating,
      partner.hseRating,
    ].filter((r): r is number => r !== null);

    return {
      ...partner,
      overallRating:
        scored.length > 0
          ? Number((scored.reduce((a, b) => a + b, 0) / scored.length).toFixed(2))
          : null,
      ratedDimensions: scored.length,
      totalDimensions: PARTNER_RATING_DIMENSIONS.length,
    };
  }
}
