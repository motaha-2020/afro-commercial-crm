import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CodeGeneratorService } from '../common/code-generator.service';
import { DataScopeService } from '../auth/data-scope.service';
import { SodService } from '../governance/sod.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { CreateAccountDto, ListAccountsQuery, UpdateAccountDto } from './dto';

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

/**
 * Credit standing is a financial decision, not a commercial one — an account
 * manager may propose it, only these roles may set it.
 */
const CREDIT_AUTHORITY: Role[] = ['FINANCE', 'CEO', 'OWNER_BOARD'];

@Injectable()
export class AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly codes: CodeGeneratorService,
    private readonly scope: DataScopeService,
    private readonly sod: SodService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(user: AuthenticatedUser, query: ListAccountsQuery) {
    const scopeFilter = await this.scope.buildFilter(user);
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);

    const where: Prisma.AccountWhereInput = {
      deletedAt: null,
      ...scopeFilter,
      ...(query.country ? { country: query.country } : {}),
      ...(query.type ? { type: query.type } : {}),
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

    const [items, total] = await Promise.all([
      this.prisma.account.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          owner: { select: { id: true, fullNameEn: true, fullNameAr: true } },
          _count: { select: { contacts: true, opportunities: true } },
        },
      }),
      this.prisma.account.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  /** Account 360: the account plus everything the spec wants on one screen. */
  async findOne(user: AuthenticatedUser, id: string) {
    const scopeFilter = await this.scope.buildFilter(user);

    const account = await this.prisma.account.findFirst({
      where: { id, deletedAt: null, ...scopeFilter },
      include: {
        owner: { select: { id: true, fullNameEn: true, fullNameAr: true } },
        parent: { select: { id: true, code: true, legalName: true } },
        contacts: { where: { deletedAt: null }, include: { roles: true } },
        opportunities: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            code: true,
            name: true,
            stage: true,
            status: true,
            forecastCategory: true,
            health: true,
            estimatedValue: true,
            currency: true,
            expectedCloseDate: true,
          },
        },
        relationshipsFrom: {
          where: { deletedAt: null },
          include: { to: { select: { id: true, code: true, legalName: true } } },
        },
      },
    });

    if (!account) {
      // 404 rather than 403: outside the caller's scope the record simply does
      // not exist for them, and we avoid confirming that an id is real.
      throw new NotFoundException('Account not found');
    }

    return account;
  }

  async create(user: AuthenticatedUser, dto: CreateAccountDto) {
    if (dto.parentId) {
      const parent = await this.prisma.account.findFirst({
        where: { id: dto.parentId, deletedAt: null },
        select: { id: true },
      });
      if (!parent) throw new NotFoundException('Parent account not found');
    }

    const year = new Date().getFullYear();
    const code = await this.codes.next('ACC', 'account', year);

    const account = await this.prisma.account.create({
      data: {
        code,
        legalName: dto.legalName,
        tradeName: dto.tradeName,
        type: dto.type,
        industry: dto.industry,
        country: dto.country,
        city: dto.city,
        address: dto.address,
        website: dto.website,
        taxId: dto.taxId,
        creditStatus: dto.creditStatus ?? 'GOOD',
        paymentTermDays: dto.paymentTermDays,
        parentId: dto.parentId,
        ownerId: dto.ownerId ?? user.id,
        orgUnitId: user.orgUnitId,
      },
    });

    await this.audit.record({
      entityType: 'Account',
      entityId: account.id,
      action: 'CREATE',
      userId: user.id,
      after: { code: account.code, legalName: account.legalName },
    });

    return account;
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateAccountDto) {
    const existing = await this.findOne(user, id);

    if (dto.creditStatus && dto.creditStatus !== existing.creditStatus) {
      if (!user.roles.some((r) => CREDIT_AUTHORITY.includes(r.role))) {
        throw new ForbiddenException(
          'Credit standing may only be set by Finance or executive management',
        );
      }
      // SoD rule 5: whoever created the account does not approve its credit.
      await this.sod.assertSeparation('SOD_05', 'Account', id, user);
    }

    const updated = await this.prisma.account.update({
      where: { id },
      data: { ...dto },
    });

    await this.audit.recordUpdate(
      'Account',
      id,
      existing as unknown as Record<string, unknown>,
      updated as unknown as Record<string, unknown>,
      user.id,
    );

    if (dto.creditStatus && dto.creditStatus !== existing.creditStatus) {
      await this.notifications.dispatchEvent('ACCOUNT_CREDIT_CHANGED', {
        title: `Credit standing changed: ${updated.legalName}`,
        body: `${existing.creditStatus} → ${updated.creditStatus}`,
        entityType: 'Account',
        entityId: id,
      });
    }

    return updated;
  }

  async remove(user: AuthenticatedUser, id: string) {
    const existing = await this.findOne(user, id);

    // Soft delete only. Block it while live opportunities still hang off the
    // account, or their history would point at a vanished parent.
    const openOpps = await this.prisma.opportunity.count({
      where: { accountId: id, deletedAt: null, status: 'ACTIVE' },
    });
    if (openOpps > 0) {
      throw new ForbiddenException(
        'Cannot delete an account with active opportunities',
      );
    }

    await this.prisma.account.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await this.audit.record({
      entityType: 'Account',
      entityId: id,
      action: 'SOFT_DELETE',
      userId: user.id,
      before: { code: existing.code, legalName: existing.legalName },
    });

    return { success: true };
  }
}
