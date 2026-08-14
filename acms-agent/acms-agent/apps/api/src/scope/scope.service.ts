import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { scopeReadiness } from '@acms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OpportunityAccessService } from '../common/opportunity-access.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type {
  CreateAssumptionDto,
  CreateClarificationDto,
  CreateScopeItemDto,
  CreateScopePackageDto,
  UpdateAssumptionDto,
  UpdateClarificationDto,
  UpdateScopeItemDto,
  UpdateScopePackageDto,
} from './dto';

export interface ItemNode {
  id: string;
  parentId: string | null;
  children: ItemNode[];
  [key: string]: unknown;
}

@Injectable()
export class ScopeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OpportunityAccessService,
  ) {}

  // -------------------------------------------------------------------------
  // Reading the whole scope
  // -------------------------------------------------------------------------

  /**
   * The Scope Builder's left-hand tree plus the readiness verdict. Assembled in
   * one call because a scope split across four requests is a scope nobody reads.
   */
  async overview(user: AuthenticatedUser, opportunityId: string) {
    const opportunity = await this.access.assert(user, opportunityId);

    const [packages, assumptions, clarifications] = await Promise.all([
      this.prisma.scopePackage.findMany({
        where: { opportunityId, deletedAt: null },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        include: {
          items: {
            where: { deletedAt: null },
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          },
        },
      }),
      this.prisma.assumption.findMany({
        where: { opportunityId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        include: { owner: { select: { id: true, fullNameEn: true, fullNameAr: true } } },
      }),
      this.prisma.clarification.findMany({
        where: { opportunityId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        include: { raisedBy: { select: { id: true, fullNameEn: true, fullNameAr: true } } },
      }),
    ]);

    const openStatuses = new Set(['OPEN', 'SENT', 'UNANSWERED_AT_SUBMISSION']);
    const open = clarifications.filter((c) => openStatuses.has(c.status));

    const readiness = scopeReadiness({
      packages: packages.length,
      items: packages.reduce((n, p) => n + p.items.length, 0),
      unconfirmedAssumptions: assumptions.filter((a) => a.confirmationStatus !== 'CONFIRMED').length,
      openClarifications: open.length,
      blockingClarifications: open.filter((c) => c.impact === 'BLOCKING').length,
    });

    return {
      opportunity,
      packages: packages.map((p) => ({ ...p, items: this.toTree(p.items as unknown as ItemNode[]) })),
      assumptions,
      clarifications,
      readiness,
    };
  }

  /** Flat rows in, nested tree out. Orphans surface at the root rather than
   *  vanishing — a lost parent must not hide its children from the estimator. */
  private toTree(rows: ItemNode[]): ItemNode[] {
    const byId = new Map(rows.map((r) => [r.id, { ...r, children: [] as ItemNode[] }]));
    const roots: ItemNode[] = [];

    for (const node of byId.values()) {
      const parent = node.parentId ? byId.get(node.parentId) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    return roots;
  }

  // -------------------------------------------------------------------------
  // Packages
  // -------------------------------------------------------------------------

  async createPackage(user: AuthenticatedUser, opportunityId: string, dto: CreateScopePackageDto) {
    await this.access.assert(user, opportunityId);

    const pkg = await this.prisma.scopePackage.create({
      data: { ...dto, opportunityId },
    });

    await this.audit.record({
      entityType: 'ScopePackage',
      entityId: pkg.id,
      action: 'CREATE',
      userId: user.id,
      after: { name: pkg.name, category: pkg.category, opportunityId },
    });

    return pkg;
  }

  async updatePackage(user: AuthenticatedUser, id: string, dto: UpdateScopePackageDto) {
    const existing = await this.packageOr404(user, id);

    const updated = await this.prisma.scopePackage.update({ where: { id }, data: { ...dto } });
    await this.audit.recordUpdate(
      'ScopePackage',
      id,
      existing as unknown as Record<string, unknown>,
      updated as unknown as Record<string, unknown>,
      user.id,
    );
    return updated;
  }

  async removePackage(user: AuthenticatedUser, id: string) {
    const existing = await this.packageOr404(user, id);

    // Children go with the parent, or the tree would keep orphaned items alive
    // and the readiness count would stay wrong forever.
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.scopeItem.updateMany({
        where: { packageId: id, deletedAt: null },
        data: { deletedAt: now },
      }),
      this.prisma.scopePackage.update({ where: { id }, data: { deletedAt: now } }),
    ]);

    await this.audit.record({
      entityType: 'ScopePackage',
      entityId: id,
      action: 'SOFT_DELETE',
      userId: user.id,
      before: { name: existing.name },
    });
    return { success: true };
  }

  // -------------------------------------------------------------------------
  // Items
  // -------------------------------------------------------------------------

  async createItem(user: AuthenticatedUser, packageId: string, dto: CreateScopeItemDto) {
    await this.packageOr404(user, packageId);

    if (dto.parentId) {
      const parent = await this.prisma.scopeItem.findFirst({
        where: { id: dto.parentId, packageId, deletedAt: null },
        select: { id: true },
      });
      // A child must sit under a parent in the same package, or the tree spans
      // two packages and neither total means anything.
      if (!parent) throw new BadRequestException('Parent item is not in this package');
    }

    const item = await this.prisma.scopeItem.create({ data: { ...dto, packageId } });
    await this.audit.record({
      entityType: 'ScopeItem',
      entityId: item.id,
      action: 'CREATE',
      userId: user.id,
      after: { name: item.name, packageId },
    });
    return item;
  }

  async updateItem(user: AuthenticatedUser, id: string, dto: UpdateScopeItemDto) {
    const existing = await this.itemOr404(user, id);

    if (dto.parentId) {
      if (dto.parentId === id) throw new BadRequestException('An item cannot be its own parent');
      if (await this.wouldCycle(id, dto.parentId)) {
        // Re-parenting an item under its own descendant would detach the whole
        // branch from the tree and lose it from every total.
        throw new BadRequestException('That move would create a cycle in the scope tree');
      }
    }

    const updated = await this.prisma.scopeItem.update({ where: { id }, data: { ...dto } });
    await this.audit.recordUpdate(
      'ScopeItem',
      id,
      existing as unknown as Record<string, unknown>,
      updated as unknown as Record<string, unknown>,
      user.id,
    );
    return updated;
  }

  private async wouldCycle(itemId: string, newParentId: string): Promise<boolean> {
    let cursor: string | null = newParentId;
    const seen = new Set<string>();
    while (cursor) {
      if (cursor === itemId) return true;
      if (seen.has(cursor)) return true;
      seen.add(cursor);
      const row: { parentId: string | null } | null = await this.prisma.scopeItem.findUnique({
        where: { id: cursor },
        select: { parentId: true },
      });
      cursor = row?.parentId ?? null;
    }
    return false;
  }

  async removeItem(user: AuthenticatedUser, id: string) {
    const existing = await this.itemOr404(user, id);

    const descendants = await this.descendantIds(id);
    const now = new Date();
    await this.prisma.scopeItem.updateMany({
      where: { id: { in: [id, ...descendants] }, deletedAt: null },
      data: { deletedAt: now },
    });

    await this.audit.record({
      entityType: 'ScopeItem',
      entityId: id,
      action: 'SOFT_DELETE',
      userId: user.id,
      before: { name: existing.name, removedDescendants: descendants.length },
    });
    return { success: true, removedDescendants: descendants.length };
  }

  private async descendantIds(rootId: string): Promise<string[]> {
    const found: string[] = [];
    let frontier = [rootId];
    while (frontier.length > 0) {
      const children = await this.prisma.scopeItem.findMany({
        where: { parentId: { in: frontier }, deletedAt: null },
        select: { id: true },
      });
      frontier = children.map((c) => c.id);
      found.push(...frontier);
    }
    return found;
  }

  // -------------------------------------------------------------------------
  // Assumptions
  // -------------------------------------------------------------------------

  async createAssumption(user: AuthenticatedUser, opportunityId: string, dto: CreateAssumptionDto) {
    await this.access.assert(user, opportunityId);

    const assumption = await this.prisma.assumption.create({
      data: { ...dto, opportunityId, ownerId: dto.ownerId ?? user.id },
    });
    await this.audit.record({
      entityType: 'Assumption',
      entityId: assumption.id,
      action: 'CREATE',
      userId: user.id,
      after: { description: assumption.description, category: assumption.category },
    });
    return assumption;
  }

  async updateAssumption(user: AuthenticatedUser, id: string, dto: UpdateAssumptionDto) {
    const existing = await this.assumptionOr404(user, id);

    const confirming =
      dto.confirmationStatus === 'CONFIRMED' && existing.confirmationStatus !== 'CONFIRMED';

    const updated = await this.prisma.assumption.update({
      where: { id },
      data: {
        ...dto,
        // Stamp the moment it became confirmed; clear it if it is walked back,
        // so the date can never outlive the status it belongs to.
        confirmedAt: confirming
          ? new Date()
          : dto.confirmationStatus && dto.confirmationStatus !== 'CONFIRMED'
            ? null
            : undefined,
      },
    });

    await this.audit.recordUpdate(
      'Assumption',
      id,
      existing as unknown as Record<string, unknown>,
      updated as unknown as Record<string, unknown>,
      user.id,
    );
    return updated;
  }

  async removeAssumption(user: AuthenticatedUser, id: string) {
    await this.assumptionOr404(user, id);
    await this.prisma.assumption.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.record({
      entityType: 'Assumption',
      entityId: id,
      action: 'SOFT_DELETE',
      userId: user.id,
    });
    return { success: true };
  }

  // -------------------------------------------------------------------------
  // Clarifications
  // -------------------------------------------------------------------------

  async createClarification(
    user: AuthenticatedUser,
    opportunityId: string,
    dto: CreateClarificationDto,
  ) {
    await this.access.assert(user, opportunityId);

    const clarification = await this.prisma.clarification.create({
      data: {
        ...dto,
        askedAt: dto.askedAt ? new Date(dto.askedAt) : undefined,
        opportunityId,
        raisedById: user.id,
      },
    });
    await this.audit.record({
      entityType: 'Clarification',
      entityId: clarification.id,
      action: 'CREATE',
      userId: user.id,
      after: { question: clarification.question, impact: clarification.impact },
    });
    return clarification;
  }

  async updateClarification(user: AuthenticatedUser, id: string, dto: UpdateClarificationDto) {
    const existing = await this.clarificationOr404(user, id);

    const answering = dto.response !== undefined && dto.response !== null;
    const updated = await this.prisma.clarification.update({
      where: { id },
      data: {
        ...dto,
        askedAt: dto.askedAt ? new Date(dto.askedAt) : undefined,
        respondedAt: dto.respondedAt
          ? new Date(dto.respondedAt)
          : answering && !existing.respondedAt
            ? new Date()
            : undefined,
        // An answered question stops being open unless the caller says otherwise.
        status: dto.status ?? (answering && existing.status !== 'CLOSED' ? 'ANSWERED' : undefined),
      },
    });

    await this.audit.recordUpdate(
      'Clarification',
      id,
      existing as unknown as Record<string, unknown>,
      updated as unknown as Record<string, unknown>,
      user.id,
    );
    return updated;
  }

  async removeClarification(user: AuthenticatedUser, id: string) {
    await this.clarificationOr404(user, id);
    await this.prisma.clarification.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.record({
      entityType: 'Clarification',
      entityId: id,
      action: 'SOFT_DELETE',
      userId: user.id,
    });
    return { success: true };
  }

  // -------------------------------------------------------------------------
  // Access gates — every child reaches its opportunity before it is touched
  // -------------------------------------------------------------------------

  private async packageOr404(user: AuthenticatedUser, id: string) {
    const pkg = await this.prisma.scopePackage.findFirst({ where: { id, deletedAt: null } });
    if (!pkg) throw new NotFoundException('Scope package not found');
    await this.access.assertVia(user, pkg.opportunityId);
    return pkg;
  }

  private async itemOr404(user: AuthenticatedUser, id: string) {
    const item = await this.prisma.scopeItem.findFirst({
      where: { id, deletedAt: null },
      include: { package: { select: { opportunityId: true } } },
    });
    if (!item) throw new NotFoundException('Scope item not found');
    await this.access.assertVia(user, item.package.opportunityId);
    return item;
  }

  private async assumptionOr404(user: AuthenticatedUser, id: string) {
    const row = await this.prisma.assumption.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundException('Assumption not found');
    await this.access.assertVia(user, row.opportunityId);
    return row;
  }

  private async clarificationOr404(user: AuthenticatedUser, id: string) {
    const row = await this.prisma.clarification.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundException('Clarification not found');
    await this.access.assertVia(user, row.opportunityId);
    return row;
  }
}
