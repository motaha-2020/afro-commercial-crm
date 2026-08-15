import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { IMPORT_DEFINITIONS } from '@acms/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { OpportunityAccessService } from '../../common/opportunity-access.service';
import type { AuthenticatedUser } from '../../auth/auth.types';
import type {
  CreateHelpers,
  ImportAdapter,
  ImportContext,
  ResolveInput,
  Resolved,
  RowValues,
} from '../import-adapter';

/**
 * The breakdown imports — a scope package's items, and a package's bill of
 * quantities.
 *
 * These are the two the request actually started from, and they are the two
 * that are genuinely trees. A flat file expresses a tree by letting a row name
 * another row: `ref` is a handle meaningful only inside the file, `parentRef`
 * points at one. The engine orders parents before children and refuses loops,
 * so an adapter here only has to say what a row means and how to write it.
 *
 * Both hang off one parent chosen before upload rather than named per row.
 * Asking once is less typing and removes the chance of spreading a single
 * breakdown across two packages by a typo on line 300.
 */

@Injectable()
export class ScopePackageImportAdapter implements ImportAdapter {
  definition = IMPORT_DEFINITIONS['scope-packages'];
  entityType = 'ScopePackage';

  constructor(
    private readonly prisma: PrismaService,
    private readonly opportunities: OpportunityAccessService,
  ) {}

  async loadContext(user: AuthenticatedUser, contextId?: string): Promise<ImportContext> {
    // Scope access is inherited from the opportunity, through the same gate the
    // rest of the module uses — an opportunity outside your scope 404s here as
    // it does everywhere else.
    const opp = await this.opportunities.assert(user, contextId!);
    return { id: opp.id, label: `${opp.name} (${opp.code})` };
  }

  async prepare() {
    return {};
  }

  resolve(input: ResolveInput): Resolved {
    return {
      label: String(input.values.name),
      parentLabel: input.context.label ?? null,
      data: {
        name: input.values.name,
        category: input.values.category,
        inclusion: input.values.inclusion,
        description: input.values.description,
        responsibleTeam: input.values.responsibleTeam,
        sortOrder: input.values.sortOrder ?? 0,
      },
    };
  }

  async create(
    tx: Prisma.TransactionClient,
    _user: AuthenticatedUser,
    row: RowValues,
    context: ImportContext,
  ) {
    const pkg = await tx.scopePackage.create({
      data: {
        ...(row.data as Prisma.ScopePackageUncheckedCreateInput),
        opportunityId: context.id!,
      },
    });
    return { id: pkg.id, label: pkg.name };
  }
}

// ---------------------------------------------------------------------------

@Injectable()
export class ScopeItemImportAdapter implements ImportAdapter {
  definition = IMPORT_DEFINITIONS['scope-items'];
  entityType = 'ScopeItem';

  constructor(
    private readonly prisma: PrismaService,
    private readonly opportunities: OpportunityAccessService,
  ) {}

  async loadContext(user: AuthenticatedUser, contextId?: string): Promise<ImportContext> {
    const pkg = await this.prisma.scopePackage.findFirst({
      where: { id: contextId, deletedAt: null },
      select: { id: true, name: true, opportunityId: true },
    });
    if (!pkg) throw new NotFoundException('Scope package not found');
    await this.opportunities.assert(user, pkg.opportunityId);
    return { id: pkg.id, label: pkg.name };
  }

  async prepare() {
    return {};
  }

  resolve(input: ResolveInput): Resolved {
    return {
      label: String(input.values.name),
      parentLabel: input.raw.parentRef || input.context.label || null,
      data: {
        name: input.values.name,
        quantity: input.values.quantity,
        unit: input.values.unit,
        responsibility: input.values.responsibility,
        description: input.values.description,
        location: input.values.location,
        technicalSpecification: input.values.technicalSpecification,
        customerResponsibility: input.values.customerResponsibility,
        afroResponsibility: input.values.afroResponsibility,
        exclusion: input.values.exclusion,
        acceptanceCriteria: input.values.acceptanceCriteria,
        sortOrder: input.values.sortOrder ?? 0,
      },
    };
  }

  async create(
    tx: Prisma.TransactionClient,
    _user: AuthenticatedUser,
    row: RowValues,
    context: ImportContext,
    helpers: CreateHelpers,
  ) {
    const item = await tx.scopeItem.create({
      data: {
        ...(row.data as Prisma.ScopeItemUncheckedCreateInput),
        packageId: context.id!,
        // Only ever a row from this same file, and the file belongs to one
        // package, so the tree cannot span two packages — which is the rule
        // createItem enforces when items are added one at a time.
        parentId: helpers.parentId,
      },
    });
    return { id: item.id, label: item.name };
  }
}

// ---------------------------------------------------------------------------

@Injectable()
export class BoqItemImportAdapter implements ImportAdapter {
  definition = IMPORT_DEFINITIONS['boq-items'];
  entityType = 'BoqItem';

  constructor(
    private readonly prisma: PrismaService,
    private readonly opportunities: OpportunityAccessService,
  ) {}

  /**
   * The lock is checked here, once, before a single row is parsed.
   *
   * An approved costing is never edited — the rule the spec states outright.
   * Discovering that per row would produce five hundred identical errors saying
   * the same thing about the file as a whole.
   */
  async loadContext(user: AuthenticatedUser, contextId?: string): Promise<ImportContext> {
    const pkg = await this.prisma.costPackage.findFirst({
      where: { id: contextId, deletedAt: null },
      select: {
        id: true,
        name: true,
        versionId: true,
        version: {
          select: {
            id: true,
            status: true,
            lockedAt: true,
            scenario: { select: { opportunityId: true } },
          },
        },
      },
    });
    if (!pkg) throw new NotFoundException('Costing package not found');

    await this.opportunities.assert(user, pkg.version.scenario.opportunityId);

    const v = pkg.version;
    if (v.lockedAt || v.status === 'APPROVED' || v.status === 'SUPERSEDED') {
      throw new ConflictException({
        message:
          'This costing version is approved and locked. Create a new version from it instead of importing into it.',
        versionId: v.id,
        status: v.status,
      });
    }
    if (v.status === 'SUBMITTED') {
      throw new ConflictException(
        'This version is awaiting approval. Withdraw or reject it before importing.',
      );
    }

    return { id: pkg.id, label: pkg.name, versionId: pkg.versionId };
  }

  async prepare() {
    return {};
  }

  resolve(input: ResolveInput): Resolved {
    const sellingRate = input.values.sellingRate as number | undefined;
    const quantity = input.values.quantity as number;
    const customerRate = input.values.customerRate as number | undefined;

    return {
      label: String(input.values.description),
      parentLabel: input.raw.parentRef || input.context.label || null,
      data: {
        itemNumber: input.values.itemNumber,
        description: input.values.description,
        technicalDescription: input.values.technicalDescription,
        quantity,
        unit: input.values.unit,
        customerRate,
        // Totals are derived on the way in exactly as createBoqItem derives
        // them, so an imported line and a typed one agree.
        customerTotal: customerRate !== undefined ? customerRate * quantity : undefined,
        sellingRate,
        sellingTotal: sellingRate !== undefined ? sellingRate * quantity : undefined,
        sortOrder: input.values.sortOrder ?? 0,
      },
    };
  }

  async create(
    tx: Prisma.TransactionClient,
    _user: AuthenticatedUser,
    row: RowValues,
    context: ImportContext,
    helpers: CreateHelpers,
  ) {
    const item = await tx.boqItem.create({
      data: {
        ...(row.data as Prisma.BoqItemUncheckedCreateInput),
        packageId: context.id!,
        parentId: helpers.parentId,
      },
    });
    return { id: item.id, label: item.description };
  }
}
