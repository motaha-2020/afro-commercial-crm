import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { CreateRefItemDto, UpdateRefItemDto, ReorderDto } from './dto';

/** A code has to survive being stored on a record and read back years later. */
const CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,39}$/;

@Injectable()
export class RefListsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Every list with its values. `activeOnly` is what the dropdowns ask for; the
   * administration screen asks for everything, because a value that was
   * switched off still has to be visible to switch back on.
   */
  async listAll(activeOnly: boolean) {
    return this.prisma.refList.findMany({
      orderBy: { key: 'asc' },
      include: {
        items: {
          where: { deletedAt: null, ...(activeOnly ? { isActive: true } : {}) },
          orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
        },
      },
    });
  }

  /**
   * The codes a write may legally use. Callers validate against this rather
   * than against a compiled enum — the entire point of the change is that the
   * legal set is now data.
   */
  async activeCodes(listKey: string): Promise<string[]> {
    const items = await this.prisma.refListItem.findMany({
      where: { listKey, isActive: true, deletedAt: null },
      select: { code: true },
    });
    return items.map((i) => i.code);
  }

  async create(user: AuthenticatedUser, listKey: string, dto: CreateRefItemDto) {
    const list = await this.prisma.refList.findUnique({ where: { key: listKey } });
    if (!list) throw new NotFoundException('Unknown list');

    // The refusal names the reason the list carries rather than a generic
    // denial: an administrator who is told "stages carry order, transitions and
    // metric definitions" knows to ask for a code change instead of retrying.
    if (!list.allowsNewItems) {
      throw new ForbiddenException(
        list.lockedReason ?? 'This list does not accept new values',
      );
    }

    const code = dto.code.trim().toUpperCase();
    if (!CODE_PATTERN.test(code)) {
      throw new BadRequestException(
        'Code must be A–Z, digits and underscore, starting with a letter',
      );
    }

    // A previously removed code is revived rather than duplicated — the same
    // rule the contact roles and partner types already follow, and the reason
    // the unique pair exists.
    const existing = await this.prisma.refListItem.findUnique({
      where: { listKey_code: { listKey, code } },
    });
    if (existing && !existing.deletedAt) {
      throw new BadRequestException('That code already exists in this list');
    }

    const data = {
      labelEn: dto.labelEn.trim(),
      labelAr: dto.labelAr.trim(),
      labelFr: dto.labelFr.trim(),
      sortOrder: dto.sortOrder ?? (await this.nextSortOrder(listKey)),
      isActive: true,
      deletedAt: null,
    };

    const item = existing
      ? await this.prisma.refListItem.update({ where: { id: existing.id }, data })
      : await this.prisma.refListItem.create({
          data: { listKey, code, isSystem: false, ...data },
        });

    await this.audit.record({
      entityType: 'RefListItem',
      entityId: item.id,
      action: existing ? 'UPDATE' : 'CREATE',
      userId: user.id,
      after: { listKey, code, ...data },
    });

    return item;
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateRefItemDto) {
    const item = await this.prisma.refListItem.findFirst({
      where: { id, deletedAt: null },
    });
    if (!item) throw new NotFoundException('Unknown value');

    const data = {
      ...(dto.labelEn !== undefined ? { labelEn: dto.labelEn.trim() } : {}),
      ...(dto.labelAr !== undefined ? { labelAr: dto.labelAr.trim() } : {}),
      ...(dto.labelFr !== undefined ? { labelFr: dto.labelFr.trim() } : {}),
      ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
    };
    if (Object.keys(data).length === 0) return item;

    const updated = await this.prisma.refListItem.update({ where: { id }, data });
    await this.audit.recordUpdate('RefListItem', id, item, updated, user.id);
    return updated;
  }

  /**
   * Removal is deactivation, and only for values the product did not ship:
   * a record created last year still has to render the value it was given, and
   * code may still name a system value by its code.
   */
  async deactivate(user: AuthenticatedUser, id: string) {
    const item = await this.prisma.refListItem.findFirst({
      where: { id, deletedAt: null },
    });
    if (!item) throw new NotFoundException('Unknown value');

    if (item.isSystem) {
      // Switching it off is allowed; erasing it is not.
      if (!item.isActive) return item;
      const off = await this.prisma.refListItem.update({
        where: { id },
        data: { isActive: false },
      });
      await this.audit.recordUpdate('RefListItem', id, item, off, user.id);
      return off;
    }

    const removed = await this.prisma.refListItem.update({
      where: { id },
      data: { isActive: false, deletedAt: new Date() },
    });
    await this.audit.record({
      entityType: 'RefListItem',
      entityId: id,
      action: 'SOFT_DELETE',
      userId: user.id,
      before: { listKey: item.listKey, code: item.code },
    });
    return removed;
  }

  /** Order is what the dropdown shows; it is set as a whole, not row by row. */
  async reorder(user: AuthenticatedUser, listKey: string, dto: ReorderDto) {
    await this.prisma.$transaction(
      dto.ids.map((id, index) =>
        this.prisma.refListItem.updateMany({
          where: { id, listKey },
          data: { sortOrder: index * 10 },
        }),
      ),
    );
    await this.audit.record({
      entityType: 'RefList',
      entityId: listKey,
      action: 'UPDATE',
      userId: user.id,
      after: { order: dto.ids },
    });
    return this.listAll(false);
  }

  private async nextSortOrder(listKey: string) {
    const last = await this.prisma.refListItem.findFirst({
      where: { listKey },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    return (last?.sortOrder ?? 0) + 10;
  }
}
