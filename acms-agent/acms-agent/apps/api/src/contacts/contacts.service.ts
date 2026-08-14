import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { DataScopeService } from '../auth/data-scope.service';
import { AccountAccessService } from '../common/account-access.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type {
  AddContactRoleDto,
  CreateContactDto,
  ListContactsQuery,
  UpdateContactDto,
} from './dto';

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

@Injectable()
export class ContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: DataScopeService,
    private readonly accounts: AccountAccessService,
  ) {}

  async list(user: AuthenticatedUser, query: ListContactsQuery) {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);

    // A contact carries no owner of its own, so visibility is expressed as a
    // condition on its account rather than on the contact row.
    const accountFilter = await this.scope.buildFilter(user);
    if (query.accountId) await this.accounts.assert(user, query.accountId);

    const where: Prisma.ContactWhereInput = {
      deletedAt: null,
      account: { deletedAt: null, ...accountFilter },
      ...(query.accountId ? { accountId: query.accountId } : {}),
      ...(query.role
        ? { roles: { some: { roleCode: query.role, deletedAt: null } } }
        : {}),
      ...(query.search
        ? {
            OR: [
              { fullName: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
              { jobTitle: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.contact.findMany({
        where,
        // Primary contact first: on an account with a dozen names it is the one
        // the caller almost always wants.
        orderBy: [{ isPrimary: 'desc' }, { fullName: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          account: { select: { id: true, code: true, legalName: true } },
          roles: { where: { deletedAt: null } },
        },
      }),
      this.prisma.contact.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async findOne(user: AuthenticatedUser, id: string) {
    const contact = await this.prisma.contact.findFirst({
      where: { id, deletedAt: null },
      include: {
        account: { select: { id: true, code: true, legalName: true } },
        roles: { where: { deletedAt: null } },
        activities: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 20,
          include: { user: { select: { id: true, fullNameEn: true, fullNameAr: true } } },
        },
        primaryFor: {
          where: { deletedAt: null },
          select: { id: true, code: true, name: true, stage: true, status: true },
        },
      },
    });

    if (!contact) throw new NotFoundException('Contact not found');
    await this.accounts.assert(user, contact.accountId);

    return contact;
  }

  async create(user: AuthenticatedUser, dto: CreateContactDto) {
    await this.accounts.assert(user, dto.accountId);

    const contact = await this.prisma.$transaction(async (tx) => {
      if (dto.isPrimary) await this.demoteExistingPrimary(tx, dto.accountId);

      return tx.contact.create({
        data: {
          accountId: dto.accountId,
          fullName: dto.fullName,
          jobTitle: dto.jobTitle,
          email: dto.email,
          phone: dto.phone,
          mobile: dto.mobile,
          influence: dto.influence,
          isPrimary: dto.isPrimary ?? false,
          notes: dto.notes,
          roles: dto.roles?.length
            ? { create: dto.roles.map((roleCode) => ({ roleCode })) }
            : undefined,
        },
        include: { roles: { where: { deletedAt: null } } },
      });
    });

    await this.audit.record({
      entityType: 'Contact',
      entityId: contact.id,
      action: 'CREATE',
      userId: user.id,
      after: {
        fullName: contact.fullName,
        accountId: contact.accountId,
        roles: dto.roles ?? [],
      },
    });

    return contact;
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateContactDto) {
    const existing = await this.findOne(user, id);

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.isPrimary && !existing.isPrimary) {
        await this.demoteExistingPrimary(tx, existing.accountId);
      }
      return tx.contact.update({
        where: { id },
        data: { ...dto },
        include: { roles: { where: { deletedAt: null } } },
      });
    });

    await this.audit.recordUpdate(
      'Contact',
      id,
      existing as unknown as Record<string, unknown>,
      updated as unknown as Record<string, unknown>,
      user.id,
    );

    return updated;
  }

  async addRole(user: AuthenticatedUser, id: string, dto: AddContactRoleDto) {
    const contact = await this.findOne(user, id);

    // A role removed earlier left a soft-deleted row behind that still holds
    // the unique pair, so granting it again revives that row instead of
    // failing on a duplicate key.
    const role = await this.prisma.contactRole.upsert({
      where: { contactId_roleCode: { contactId: id, roleCode: dto.roleCode } },
      create: { contactId: id, roleCode: dto.roleCode, notes: dto.notes },
      update: { deletedAt: null, notes: dto.notes },
    });

    await this.audit.record({
      entityType: 'Contact',
      entityId: id,
      action: 'UPDATE',
      userId: user.id,
      after: { addedRole: dto.roleCode, contact: contact.fullName },
    });

    return role;
  }

  async removeRole(user: AuthenticatedUser, id: string, roleCode: string) {
    await this.findOne(user, id);

    const role = await this.prisma.contactRole.findFirst({
      where: { contactId: id, roleCode, deletedAt: null },
    });
    if (!role) throw new NotFoundException('Contact role not found');

    await this.prisma.contactRole.update({
      where: { id: role.id },
      data: { deletedAt: new Date() },
    });

    await this.audit.record({
      entityType: 'Contact',
      entityId: id,
      action: 'UPDATE',
      userId: user.id,
      before: { role: roleCode },
    });

    return { success: true };
  }

  async remove(user: AuthenticatedUser, id: string) {
    const existing = await this.findOne(user, id);

    // A contact named as an opportunity's primary contact cannot vanish, or
    // that opportunity loses the only person it can be discussed with.
    const primaryFor = await this.prisma.opportunity.count({
      where: { primaryContactId: id, deletedAt: null },
    });
    if (primaryFor > 0) {
      throw new BadRequestException(
        'Contact is the primary contact on an opportunity; replace them there first',
      );
    }

    await this.prisma.contact.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await this.audit.record({
      entityType: 'Contact',
      entityId: id,
      action: 'SOFT_DELETE',
      userId: user.id,
      before: { fullName: existing.fullName, accountId: existing.accountId },
    });

    return { success: true };
  }

  /**
   * "Primary" is a claim about the account, not about the contact, so it can
   * only be true once. Promoting one demotes the incumbent in the same
   * transaction rather than leaving two rows both claiming it.
   */
  private async demoteExistingPrimary(tx: Prisma.TransactionClient, accountId: string) {
    await tx.contact.updateMany({
      where: { accountId, isPrimary: true, deletedAt: null },
      data: { isPrimary: false },
    });
  }
}
