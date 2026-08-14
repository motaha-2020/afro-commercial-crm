import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { CreateCostElementDto, CreateResourceDto } from './dto';

/** Rates and cost elements are shared master data; editing them moves every
 *  future bid, so it is not an estimator's decision alone. */
const LIBRARY_AUTHORITY: Role[] = [
  'SYSTEM_ADMIN',
  'FINANCE',
  'ESTIMATION',
  'CEO',
  'OWNER_BOARD',
];

@Injectable()
export class LibraryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  listElements(category?: string) {
    return this.prisma.costElement.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        ...(category ? { category: category as never } : {}),
      },
      orderBy: [{ category: 'asc' }, { code: 'asc' }],
    });
  }

  async createElement(user: AuthenticatedUser, dto: CreateCostElementDto) {
    this.assertAuthority(user);
    const element = await this.prisma.costElement.create({ data: dto });
    await this.audit.record({
      entityType: 'CostElement',
      entityId: element.id,
      action: 'CREATE',
      userId: user.id,
      after: { code: element.code, category: element.category },
    });
    return element;
  }

  /**
   * Resources are effective-dated. The default view is what is true today —
   * "يجب الاحتفاظ بتاريخ الأسعار، وليس استبدال السعر القديم" — but `asOf` can
   * ask what a rate was on the day an old bid was priced.
   */
  listResources(params: { type?: string; asOf?: string; code?: string }) {
    const at = params.asOf ? new Date(params.asOf) : new Date();
    return this.prisma.resource.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        ...(params.type ? { type: params.type as never } : {}),
        ...(params.code ? { code: params.code } : {}),
        effectiveFrom: { lte: at },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: at } }],
      },
      orderBy: [{ type: 'asc' }, { code: 'asc' }],
    });
  }

  /**
   * A new price is a new row, and the previous one is closed off the day before
   * — never overwritten. That is what makes an old costing explainable.
   */
  async createResource(user: AuthenticatedUser, dto: CreateResourceDto) {
    this.assertAuthority(user);
    const from = new Date(dto.effectiveFrom);

    const current = await this.prisma.resource.findFirst({
      where: { code: dto.code, deletedAt: null, effectiveTo: null },
      orderBy: { effectiveFrom: 'desc' },
    });

    const resource = await this.prisma.$transaction(async (tx) => {
      if (current && current.effectiveFrom < from) {
        await tx.resource.update({
          where: { id: current.id },
          data: { effectiveTo: new Date(from.getTime() - 86_400_000) },
        });
      }
      return tx.resource.create({
        data: {
          ...dto,
          effectiveFrom: from,
          effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : undefined,
        },
      });
    });

    await this.audit.record({
      entityType: 'Resource',
      entityId: resource.id,
      action: 'CREATE',
      userId: user.id,
      after: {
        code: resource.code,
        standardCost: String(resource.standardCost),
        effectiveFrom: from.toISOString(),
        supersededRate: current?.id ?? null,
      },
    });

    return resource;
  }

  /** Every price this resource code has ever carried, newest first. */
  async priceHistory(code: string) {
    const rows = await this.prisma.resource.findMany({
      where: { code, deletedAt: null },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (rows.length === 0) throw new NotFoundException('No such resource code');
    return rows;
  }

  private assertAuthority(user: AuthenticatedUser) {
    if (!user.roles.some((r) => LIBRARY_AUTHORITY.includes(r.role))) {
      throw new ForbiddenException(
        'Cost library changes are reserved to estimation, finance or administration',
      );
    }
  }
}
