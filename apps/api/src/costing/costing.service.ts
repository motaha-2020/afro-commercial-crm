import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  NOT_YET_COMPUTABLE,
  computeIndirectCosts,
  costConfidence,
  warningsForVersion,
  costLineTotal,
  priceForTargetMargin,
  rollup,
  type CostSource,
} from '@acms/shared';
import type { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CostRulesService } from './cost-rules.service';
import { OpportunityAccessService } from '../common/opportunity-access.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SodService } from '../governance/sod.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type {
  CreateBoqItemDto,
  CreateBreakdownDto,
  CreatePackageDto,
  CreateScenarioDto,
  CreateVersionDto,
  RejectVersionDto,
  UpdateBoqItemDto,
  UpdateBreakdownDto,
  UpdatePackageDto,
  UpdateScenarioDto,
} from './dto';

/** Who may approve a costing. Finance and executive management, not sales. */
const COSTING_APPROVERS: Role[] = ['FINANCE', 'CEO', 'OWNER_BOARD', 'SALES_DIRECTOR'];

@Injectable()
export class CostingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly costRules: CostRulesService,
    private readonly access: OpportunityAccessService,
    private readonly notifications: NotificationsService,
    private readonly sod: SodService,
  ) {}

  // -------------------------------------------------------------------------
  // Scenarios
  // -------------------------------------------------------------------------

  async listScenarios(user: AuthenticatedUser, opportunityId: string) {
    await this.access.assert(user, opportunityId);

    const scenarios = await this.prisma.costingScenario.findMany({
      where: { opportunityId, deletedAt: null },
      orderBy: [{ isSelected: 'desc' }, { createdAt: 'asc' }],
      include: {
        versions: {
          where: { deletedAt: null },
          orderBy: { versionNumber: 'desc' },
          select: {
            id: true,
            versionNumber: true,
            status: true,
            lockedAt: true,
            totalCost: true,
            totalPrice: true,
            marginPercent: true,
          },
        },
      },
    });

    return scenarios;
  }

  async createScenario(user: AuthenticatedUser, opportunityId: string, dto: CreateScenarioDto) {
    await this.access.assert(user, opportunityId);

    const scenario = await this.prisma.costingScenario.create({
      data: {
        ...dto,
        exchangeRateDate: dto.exchangeRateDate ? new Date(dto.exchangeRateDate) : undefined,
        opportunityId,
        createdById: user.id,
      },
    });

    await this.audit.record({
      entityType: 'CostingScenario',
      entityId: scenario.id,
      action: 'CREATE',
      userId: user.id,
      after: { name: scenario.name, type: scenario.type, opportunityId },
    });

    return scenario;
  }

  async updateScenario(user: AuthenticatedUser, id: string, dto: UpdateScenarioDto) {
    const existing = await this.scenarioOr404(user, id);

    const updated = await this.prisma.costingScenario.update({
      where: { id },
      data: {
        ...dto,
        exchangeRateDate: dto.exchangeRateDate ? new Date(dto.exchangeRateDate) : undefined,
      },
    });
    await this.audit.recordUpdate(
      'CostingScenario',
      id,
      existing as unknown as Record<string, unknown>,
      updated as unknown as Record<string, unknown>,
      user.id,
    );
    return updated;
  }

  /**
   * Exactly one scenario is carried forward. Selecting one deselects the rest in
   * the same transaction — two "selected" scenarios would make every downstream
   * total ambiguous.
   */
  async selectScenario(user: AuthenticatedUser, id: string) {
    const scenario = await this.scenarioOr404(user, id);

    await this.prisma.$transaction([
      this.prisma.costingScenario.updateMany({
        where: { opportunityId: scenario.opportunityId, deletedAt: null },
        data: { isSelected: false },
      }),
      this.prisma.costingScenario.update({ where: { id }, data: { isSelected: true } }),
    ]);

    await this.audit.record({
      entityType: 'CostingScenario',
      entityId: id,
      action: 'UPDATE',
      userId: user.id,
      after: { isSelected: true },
    });

    return { success: true };
  }

  // -------------------------------------------------------------------------
  // Versions — the locking rule lives here
  // -------------------------------------------------------------------------

  async createVersion(user: AuthenticatedUser, scenarioId: string, dto: CreateVersionDto) {
    await this.scenarioOr404(user, scenarioId);

    const last = await this.prisma.costingVersion.findFirst({
      where: { scenarioId },
      orderBy: { versionNumber: 'desc' },
      select: { versionNumber: true, id: true },
    });

    const version = await this.prisma.costingVersion.create({
      data: {
        scenarioId,
        versionNumber: (last?.versionNumber ?? 0) + 1,
        revisionReason: dto.revisionReason,
        previousVersionId: dto.cloneFromVersionId ?? last?.id,
        createdById: user.id,
      },
    });

    if (dto.cloneFromVersionId) {
      await this.cloneInto(version.id, dto.cloneFromVersionId, user);
    }

    await this.audit.record({
      entityType: 'CostingVersion',
      entityId: version.id,
      action: 'CREATE',
      userId: user.id,
      after: {
        scenarioId,
        versionNumber: version.versionNumber,
        clonedFrom: dto.cloneFromVersionId ?? null,
      },
    });

    return version;
  }

  /** Deep copy: packages, the BOQ tree with its parent links, and every
   *  breakdown line. Parents are remapped so the clone's tree is its own. */
  private async cloneInto(targetVersionId: string, sourceVersionId: string, user: AuthenticatedUser) {
    const packages = await this.prisma.costPackage.findMany({
      where: { versionId: sourceVersionId, deletedAt: null },
      include: {
        items: {
          where: { deletedAt: null },
          include: { breakdown: { where: { deletedAt: null } } },
        },
      },
    });

    for (const pkg of packages) {
      const newPkg = await this.prisma.costPackage.create({
        data: {
          versionId: targetVersionId,
          code: pkg.code,
          name: pkg.name,
          type: pkg.type,
          ownerId: pkg.ownerId,
          sortOrder: pkg.sortOrder,
        },
      });

      // Two passes: create every item first, then fix parents, so a child
      // copied before its parent still lands in the right place.
      const idMap = new Map<string, string>();
      for (const item of pkg.items) {
        const created = await this.prisma.boqItem.create({
          data: {
            packageId: newPkg.id,
            itemNumber: item.itemNumber,
            description: item.description,
            technicalDescription: item.technicalDescription,
            quantity: item.quantity,
            unit: item.unit,
            customerRate: item.customerRate,
            customerTotal: item.customerTotal,
            internalCost: item.internalCost,
            sellingRate: item.sellingRate,
            sellingTotal: item.sellingTotal,
            grossProfit: item.grossProfit,
            grossMargin: item.grossMargin,
            sortOrder: item.sortOrder,
          },
        });
        idMap.set(item.id, created.id);

        for (const line of item.breakdown) {
          await this.prisma.costBreakdown.create({
            data: {
              boqItemId: created.id,
              elementId: line.elementId,
              resourceId: line.resourceId,
              description: line.description,
              quantity: line.quantity,
              unit: line.unit,
              unitCost: line.unitCost,
              wastePercent: line.wastePercent,
              productivityRate: line.productivityRate,
              durationDays: line.durationDays,
              exchangeRate: line.exchangeRate,
              taxAmount: line.taxAmount,
              allocationPercent: line.allocationPercent,
              totalCost: line.totalCost,
              source: line.source,
              sourceReference: line.sourceReference,
            },
          });
        }
      }

      for (const item of pkg.items) {
        if (!item.parentId) continue;
        const newId = idMap.get(item.id);
        const newParent = idMap.get(item.parentId);
        if (newId && newParent) {
          await this.prisma.boqItem.update({
            where: { id: newId },
            data: { parentId: newParent },
          });
        }
      }
    }

    await this.audit.record({
      entityType: 'CostingVersion',
      entityId: targetVersionId,
      action: 'UPDATE',
      userId: user.id,
      after: { clonedFrom: sourceVersionId, packages: packages.length },
    });
  }

  async submitVersion(user: AuthenticatedUser, id: string) {
    const version = await this.versionOr404(user, id);
    if (version.status !== 'DRAFT' && version.status !== 'REJECTED') {
      throw new ConflictException(`A ${version.status} version cannot be submitted`);
    }

    const totals = await this.computeTotals(id);
    if (totals.rollup.totalCost <= 0) {
      // Submitting a costing with no cost in it is always a mistake, and it
      // would sail through approval looking like a 100% margin.
      throw new BadRequestException('This version has no costed lines to approve');
    }

    const updated = await this.prisma.costingVersion.update({
      where: { id },
      data: {
        status: 'SUBMITTED',
        submittedAt: new Date(),
        submittedById: user.id,
        totalCost: totals.rollup.totalCost,
        totalPrice: totals.rollup.totalPrice,
        marginPercent: totals.rollup.marginPercent,
      },
    });

    await this.audit.record({
      entityType: 'CostingVersion',
      entityId: id,
      action: 'STATUS_CHANGE',
      userId: user.id,
      before: { status: version.status },
      after: { status: 'SUBMITTED', ...totals.rollup },
    });

    await this.notifications.dispatchEvent('COSTING_SUBMITTED', {
      title: `Costing v${version.versionNumber} submitted for approval`,
      body: `Cost ${totals.rollup.totalCost} • margin ${totals.rollup.marginPercent}%`,
      entityType: 'CostingVersion',
      entityId: id,
    });

    return updated;
  }

  /**
   * Approval locks the version for good. SoD rule 1 — "من ينشئ Costing لا
   * يعتمدها نهائيًا" — is enforced here, now that both halves of it exist.
   */
  async approveVersion(user: AuthenticatedUser, id: string) {
    const version = await this.versionOr404(user, id);
    if (version.status !== 'SUBMITTED') {
      throw new ConflictException(`Only a submitted version can be approved (this one is ${version.status})`);
    }
    if (!user.roles.some((r) => COSTING_APPROVERS.includes(r.role))) {
      throw new ForbiddenException('Costing approval is reserved to finance or management');
    }

    await this.sod.assertSeparation('SOD_01', 'CostingVersion', id, user);

    const totals = await this.computeTotals(id);
    const now = new Date();

    const [updated] = await this.prisma.$transaction([
      this.prisma.costingVersion.update({
        where: { id },
        data: {
          status: 'APPROVED',
          approvedAt: now,
          approvedById: user.id,
          lockedAt: now,
          totalCost: totals.rollup.totalCost,
          totalPrice: totals.rollup.totalPrice,
          marginPercent: totals.rollup.marginPercent,
        },
      }),
      // Any previously approved version of the same scenario steps aside; two
      // approved costings would leave "the approved price" undefined.
      this.prisma.costingVersion.updateMany({
        where: {
          scenarioId: version.scenarioId,
          id: { not: id },
          status: 'APPROVED',
          deletedAt: null,
        },
        data: { status: 'SUPERSEDED' },
      }),
    ]);

    await this.audit.record({
      entityType: 'CostingVersion',
      entityId: id,
      action: 'STATUS_CHANGE',
      userId: user.id,
      before: { status: 'SUBMITTED' },
      after: { status: 'APPROVED', locked: true, ...totals.rollup },
    });

    await this.notifications.dispatchEvent('COSTING_APPROVED', {
      title: `Costing v${version.versionNumber} approved`,
      body: `Margin ${totals.rollup.marginPercent}%`,
      entityType: 'CostingVersion',
      entityId: id,
    });

    return updated;
  }

  async rejectVersion(user: AuthenticatedUser, id: string, dto: RejectVersionDto) {
    const version = await this.versionOr404(user, id);
    if (version.status !== 'SUBMITTED') {
      throw new ConflictException('Only a submitted version can be rejected');
    }
    if (!user.roles.some((r) => COSTING_APPROVERS.includes(r.role))) {
      throw new ForbiddenException('Costing approval is reserved to finance or management');
    }

    const updated = await this.prisma.costingVersion.update({
      where: { id },
      data: { status: 'REJECTED', rejectionReason: dto.reason },
    });

    await this.audit.record({
      entityType: 'CostingVersion',
      entityId: id,
      action: 'STATUS_CHANGE',
      userId: user.id,
      before: { status: 'SUBMITTED' },
      after: { status: 'REJECTED', reason: dto.reason },
    });

    await this.notifications.dispatchEvent('COSTING_REJECTED', {
      title: `Costing v${version.versionNumber} rejected`,
      body: dto.reason,
      entityType: 'CostingVersion',
      entityId: id,
    });

    return updated;
  }

  /** The full costing sheet, with totals rolled up from the bottom. */
  async versionDetail(user: AuthenticatedUser, id: string) {
    await this.versionOr404(user, id);
    const totals = await this.computeTotals(id);

    const version = await this.prisma.costingVersion.findUnique({
      where: { id },
      include: {
        scenario: {
          select: {
            id: true,
            name: true,
            currency: true,
            opportunityId: true,
            // Country and business unit decide which overhead rules apply.
            opportunity: { select: { id: true, country: true, orgUnitId: true } },
          },
        },
        createdBy: { select: { id: true, fullNameEn: true, fullNameAr: true } },
        approvedBy: { select: { id: true, fullNameEn: true, fullNameAr: true } },
        packages: {
          where: { deletedAt: null },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          include: {
            items: {
              where: { deletedAt: null },
              orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
              include: {
                breakdown: {
                  where: { deletedAt: null },
                  include: {
                    element: { select: { code: true, nameEn: true, nameAr: true, category: true } },
                    resource: { select: { code: true, nameEn: true, nameAr: true, unit: true } },
                  },
                },
              },
            },
          },
        },
      },
    });

    // The spec's Visual Warnings. Computed on read rather than stored: every
    // input moves underneath them — a quotation lapses with the passage of
    // time alone, and a stored flag would still say the price was firm.
    const opportunityScope = version?.scenario.opportunity ?? null;
    const items = (version?.packages ?? []).flatMap((p) => p.items);
    const quoteExpiry = await this.quotationExpiryByReference(
      items.flatMap((i) => i.breakdown.map((b) => b.sourceReference)),
    );

    const warnings = warningsForVersion(
      items.map((item) => ({
        id: item.id,
        quantity: item.quantity === null ? null : Number(item.quantity),
        internalCost: item.internalCost === null ? null : Number(item.internalCost),
        sellingTotal: item.sellingTotal === null ? null : Number(item.sellingTotal),
        breakdown: item.breakdown.map((b) => ({
          id: b.id,
          source: b.source,
          totalCost: Number(b.totalCost),
          elementId: b.elementId,
          quotationValidUntil: b.sourceReference
            ? (quoteExpiry.get(b.sourceReference) ?? null)
            : null,
        })),
      })),
    );

    // The overheads the spec's summary bar asks for. Direct cost is what the
    // breakdown lines add up to; the rules are applied on top and never feed
    // each other, so the total does not depend on the order they were entered.
    const indirect = computeIndirectCosts(await this.costRules.allRules(), {
      directCost: totals.rollup.totalCost,
      sellingPrice: totals.rollup.totalPrice,
    }, {
      country: opportunityScope?.country ?? null,
      orgUnitId: opportunityScope?.orgUnitId ?? null,
      // Without this the bid's own rule is stored and never applies: it would
      // read as a group rule at resolution time and be overridden by every
      // narrower scope, which is the opposite of what it was written for.
      opportunityId: opportunityScope?.id ?? null,
    });

    const totalCost = Math.round((totals.rollup.totalCost + indirect.total) * 100) / 100;
    const grossProfit = Math.round((totals.rollup.totalPrice - totalCost) * 100) / 100;

    return {
      ...version,
      totals: {
        ...totals.rollup,
        // Kept apart rather than merged: a reader has to be able to see how
        // much of the cost is work and how much is the company running.
        directCost: totals.rollup.totalCost,
        indirectCost: indirect.total,
        totalCost,
        grossProfit,
        /// Margin on direct cost alone — what the item-level pricing works to.
        /// Kept beside the real one rather than replaced: an estimator prices
        /// against direct cost, and a reader needs to see both the number they
        /// priced to and the number the company actually earns.
        marginPercentDirect: totals.rollup.marginPercent,
        marginPercent:
          totals.rollup.totalPrice > 0
            ? Math.round((grossProfit / totals.rollup.totalPrice) * 10000) / 100
            : 0,
      },
      indirect: {
        applied: indirect.applied,
        byCategory: indirect.byCategory,
        // An overhead that quietly failed to apply is a bid cheaper than the
        // company can deliver for, so the reason is carried to the screen.
        skipped: indirect.skipped,
      },
      confidence: totals.confidence,
      packageTotals: totals.byPackage,
      warnings,
      // Named so the screen can say which checks it is NOT doing. A warning
      // that never fires reads as assurance.
      notChecked: NOT_YET_COMPUTABLE,
    };
  }

  /**
   * Validity dates of the quotations behind cost lines, keyed by the reference
   * the costing link wrote onto them.
   *
   * One query for the whole version rather than one per line: a costing with
   * three hundred lines would otherwise open three hundred round trips to
   * decide the colour of a row.
   */
  private async quotationExpiryByReference(references: (string | null)[]) {
    const codes = [
      ...new Set(
        references
          .filter((r): r is string => Boolean(r))
          // The link writes "CODE · Partner name"; the code is what identifies it.
          .map((r) => r.split('·')[0].trim()),
      ),
    ];
    if (codes.length === 0) return new Map<string, Date>();

    const quotations = await this.prisma.partnerQuotation.findMany({
      where: { code: { in: codes }, deletedAt: null },
      select: { code: true, validUntil: true },
    });

    const byReference = new Map<string, Date>();
    for (const reference of references) {
      if (!reference) continue;
      const code = reference.split('·')[0].trim();
      const found = quotations.find((q) => q.code === code);
      if (found?.validUntil) byReference.set(reference, found.validUntil);
    }
    return byReference;
  }

  /**
   * Rolls costs up from breakdown lines rather than trusting stored figures:
   * the stored ones are a cache, and a cache that is never re-derived is just a
   * number nobody has checked.
   */
  private async computeTotals(versionId: string) {
    const packages = await this.prisma.costPackage.findMany({
      where: { versionId, deletedAt: null },
      include: {
        items: {
          where: { deletedAt: null },
          include: { breakdown: { where: { deletedAt: null } } },
        },
      },
    });

    const confidenceLines: { cost: number; source: CostSource }[] = [];
    const byPackage: Record<string, ReturnType<typeof rollup>> = {};
    const allLines: { cost: number; price: number }[] = [];

    for (const pkg of packages) {
      const pkgLines = pkg.items.map((item) => {
        const cost = item.breakdown.reduce((s, b) => s + Number(b.totalCost), 0);
        for (const b of item.breakdown) {
          confidenceLines.push({ cost: Number(b.totalCost), source: b.source });
        }
        return { cost, price: Number(item.sellingTotal ?? 0) };
      });
      byPackage[pkg.id] = rollup(pkgLines);
      allLines.push(...pkgLines);
    }

    return {
      rollup: rollup(allLines),
      confidence: costConfidence(confidenceLines),
      byPackage,
    };
  }

  // -------------------------------------------------------------------------
  // Packages, BOQ items and breakdown — all refused on a locked version
  // -------------------------------------------------------------------------

  async createPackage(user: AuthenticatedUser, versionId: string, dto: CreatePackageDto) {
    await this.assertEditable(user, versionId);
    const pkg = await this.prisma.costPackage.create({ data: { ...dto, versionId } });
    await this.audit.record({
      entityType: 'CostPackage',
      entityId: pkg.id,
      action: 'CREATE',
      userId: user.id,
      after: { name: pkg.name, versionId },
    });
    return pkg;
  }

  async updatePackage(user: AuthenticatedUser, id: string, dto: UpdatePackageDto) {
    const pkg = await this.packageOr404(user, id);
    await this.assertEditable(user, pkg.versionId);
    const updated = await this.prisma.costPackage.update({ where: { id }, data: { ...dto } });
    await this.audit.recordUpdate(
      'CostPackage',
      id,
      pkg as unknown as Record<string, unknown>,
      updated as unknown as Record<string, unknown>,
      user.id,
    );
    return updated;
  }

  async removePackage(user: AuthenticatedUser, id: string) {
    const pkg = await this.packageOr404(user, id);
    await this.assertEditable(user, pkg.versionId);
    await this.prisma.costPackage.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.record({
      entityType: 'CostPackage',
      entityId: id,
      action: 'SOFT_DELETE',
      userId: user.id,
    });
    return { success: true };
  }

  async createBoqItem(user: AuthenticatedUser, packageId: string, dto: CreateBoqItemDto) {
    const pkg = await this.packageOr404(user, packageId);
    await this.assertEditable(user, pkg.versionId);

    if (dto.parentId) {
      const parent = await this.prisma.boqItem.findFirst({
        where: { id: dto.parentId, packageId, deletedAt: null },
        select: { id: true },
      });
      if (!parent) throw new BadRequestException('Parent item is not in this package');
    }

    const item = await this.prisma.boqItem.create({
      data: {
        packageId,
        parentId: dto.parentId,
        itemNumber: dto.itemNumber,
        description: dto.description,
        technicalDescription: dto.technicalDescription,
        quantity: dto.quantity,
        unit: dto.unit,
        customerRate: dto.customerRate,
        customerTotal:
          dto.customerRate !== undefined ? dto.customerRate * dto.quantity : undefined,
        sellingRate: dto.sellingRate,
        sellingTotal: dto.sellingRate !== undefined ? dto.sellingRate * dto.quantity : undefined,
        sortOrder: dto.sortOrder ?? 0,
      },
    });

    await this.audit.record({
      entityType: 'BoqItem',
      entityId: item.id,
      action: 'CREATE',
      userId: user.id,
      after: { description: item.description, quantity: dto.quantity },
    });

    if (dto.targetMarginPercent !== undefined) await this.reprice(item.id, dto.targetMarginPercent);
    return this.prisma.boqItem.findUnique({ where: { id: item.id } });
  }

  async updateBoqItem(user: AuthenticatedUser, id: string, dto: UpdateBoqItemDto) {
    const item = await this.boqItemOr404(user, id);
    await this.assertEditable(user, item.package.versionId);

    const quantity = dto.quantity ?? Number(item.quantity);
    const updated = await this.prisma.boqItem.update({
      where: { id },
      data: {
        ...dto,
        targetMarginPercent: undefined,
        customerTotal:
          dto.customerRate !== undefined ? dto.customerRate * quantity : undefined,
        sellingTotal: dto.sellingRate !== undefined ? dto.sellingRate * quantity : undefined,
      } as Prisma.BoqItemUpdateInput,
    });

    await this.audit.recordUpdate(
      'BoqItem',
      id,
      item as unknown as Record<string, unknown>,
      updated as unknown as Record<string, unknown>,
      user.id,
    );

    await this.recalculate(id, dto.targetMarginPercent);
    return this.prisma.boqItem.findUnique({ where: { id } });
  }

  async removeBoqItem(user: AuthenticatedUser, id: string) {
    const item = await this.boqItemOr404(user, id);
    await this.assertEditable(user, item.package.versionId);

    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.costBreakdown.updateMany({
        where: { boqItemId: id, deletedAt: null },
        data: { deletedAt: now },
      }),
      this.prisma.boqItem.update({ where: { id }, data: { deletedAt: now } }),
    ]);

    await this.audit.record({
      entityType: 'BoqItem',
      entityId: id,
      action: 'SOFT_DELETE',
      userId: user.id,
    });
    return { success: true };
  }

  async addBreakdown(user: AuthenticatedUser, boqItemId: string, dto: CreateBreakdownDto) {
    const item = await this.boqItemOr404(user, boqItemId);
    await this.assertEditable(user, item.package.versionId);

    const totalCost = costLineTotal({
      quantity: dto.quantity,
      unitCost: dto.unitCost,
      wastePercent: dto.wastePercent,
      productivityRate: dto.productivityRate,
      exchangeRate: dto.exchangeRate,
      taxAmount: dto.taxAmount,
      allocationPercent: dto.allocationPercent,
    });

    const line = await this.prisma.costBreakdown.create({
      data: { ...dto, boqItemId, totalCost },
    });

    await this.audit.record({
      entityType: 'CostBreakdown',
      entityId: line.id,
      action: 'CREATE',
      userId: user.id,
      after: { boqItemId, totalCost, source: line.source },
    });

    await this.recalculate(boqItemId);
    return line;
  }

  async updateBreakdown(user: AuthenticatedUser, id: string, dto: UpdateBreakdownDto) {
    const line = await this.breakdownOr404(user, id);
    await this.assertEditable(user, line.boqItem.package.versionId);

    const merged = {
      quantity: dto.quantity ?? Number(line.quantity),
      unitCost: dto.unitCost ?? Number(line.unitCost),
      wastePercent: dto.wastePercent ?? Number(line.wastePercent ?? 0),
      // A stored rate of zero means "not set"; passing it through would be read
      // as "produces nothing per day".
      productivityRate:
        dto.productivityRate ?? (Number(line.productivityRate ?? 0) || undefined),
      exchangeRate: dto.exchangeRate ?? Number(line.exchangeRate ?? 1),
      taxAmount: dto.taxAmount ?? Number(line.taxAmount ?? 0),
      allocationPercent: dto.allocationPercent ?? Number(line.allocationPercent ?? 100),
    };

    const updated = await this.prisma.costBreakdown.update({
      where: { id },
      data: { ...dto, totalCost: costLineTotal(merged) },
    });

    await this.audit.recordUpdate(
      'CostBreakdown',
      id,
      line as unknown as Record<string, unknown>,
      updated as unknown as Record<string, unknown>,
      user.id,
    );

    await this.recalculate(line.boqItemId);
    return updated;
  }

  async removeBreakdown(user: AuthenticatedUser, id: string) {
    const line = await this.breakdownOr404(user, id);
    await this.assertEditable(user, line.boqItem.package.versionId);

    await this.prisma.costBreakdown.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.record({
      entityType: 'CostBreakdown',
      entityId: id,
      action: 'SOFT_DELETE',
      userId: user.id,
    });
    await this.recalculate(line.boqItemId);
    return { success: true };
  }

  /** Re-derives an item's cost from its lines, and its margin from cost+price. */
  private async recalculate(boqItemId: string, targetMarginPercent?: number) {
    if (targetMarginPercent !== undefined) {
      await this.reprice(boqItemId, targetMarginPercent);
      return;
    }

    const item = await this.prisma.boqItem.findUnique({
      where: { id: boqItemId },
      include: { breakdown: { where: { deletedAt: null } } },
    });
    if (!item) return;

    const cost = item.breakdown.reduce((s, b) => s + Number(b.totalCost), 0);
    const price = Number(item.sellingTotal ?? 0);
    const totals = rollup([{ cost, price }]);

    await this.prisma.boqItem.update({
      where: { id: boqItemId },
      data: {
        internalCost: totals.totalCost,
        grossProfit: totals.grossProfit,
        grossMargin: totals.marginPercent,
      },
    });
  }

  /** Prices an item to hit a target MARGIN (over price, never over cost). */
  private async reprice(boqItemId: string, targetMarginPercent: number) {
    const item = await this.prisma.boqItem.findUnique({
      where: { id: boqItemId },
      include: { breakdown: { where: { deletedAt: null } } },
    });
    if (!item) return;

    const cost = item.breakdown.reduce((s, b) => s + Number(b.totalCost), 0);
    const price = priceForTargetMargin(cost, targetMarginPercent);
    const quantity = Number(item.quantity) || 1;
    const totals = rollup([{ cost, price }]);

    await this.prisma.boqItem.update({
      where: { id: boqItemId },
      data: {
        internalCost: totals.totalCost,
        sellingTotal: price,
        sellingRate: price / quantity,
        grossProfit: totals.grossProfit,
        grossMargin: totals.marginPercent,
      },
    });
  }

  // -------------------------------------------------------------------------
  // Gates
  // -------------------------------------------------------------------------

  /**
   * The rule the spec states outright: an approved costing is never edited.
   * Every write goes through here, so there is one place to be sure of rather
   * than a check each endpoint has to remember.
   */
  private async assertEditable(user: AuthenticatedUser, versionId: string) {
    const version = await this.versionOr404(user, versionId);
    if (version.lockedAt || version.status === 'APPROVED' || version.status === 'SUPERSEDED') {
      throw new ConflictException({
        message:
          'This costing version is approved and locked. Create a new version from it instead of editing it.',
        versionId,
        status: version.status,
      });
    }
    if (version.status === 'SUBMITTED') {
      throw new ConflictException(
        'This version is awaiting approval. Withdraw or reject it before editing.',
      );
    }
    return version;
  }

  private async scenarioOr404(user: AuthenticatedUser, id: string) {
    const row = await this.prisma.costingScenario.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundException('Costing scenario not found');
    await this.access.assertVia(user, row.opportunityId);
    return row;
  }

  private async versionOr404(user: AuthenticatedUser, id: string) {
    const row = await this.prisma.costingVersion.findFirst({
      where: { id, deletedAt: null },
      include: { scenario: { select: { opportunityId: true } } },
    });
    if (!row) throw new NotFoundException('Costing version not found');
    await this.access.assertVia(user, row.scenario.opportunityId);
    return row;
  }

  private async packageOr404(user: AuthenticatedUser, id: string) {
    const row = await this.prisma.costPackage.findFirst({
      where: { id, deletedAt: null },
      include: { version: { include: { scenario: { select: { opportunityId: true } } } } },
    });
    if (!row) throw new NotFoundException('Cost package not found');
    await this.access.assertVia(user, row.version.scenario.opportunityId);
    return row;
  }

  private async boqItemOr404(user: AuthenticatedUser, id: string) {
    const row = await this.prisma.boqItem.findFirst({
      where: { id, deletedAt: null },
      include: {
        package: {
          include: { version: { include: { scenario: { select: { opportunityId: true } } } } },
        },
      },
    });
    if (!row) throw new NotFoundException('BOQ item not found');
    await this.access.assertVia(user, row.package.version.scenario.opportunityId);
    return row;
  }

  private async breakdownOr404(user: AuthenticatedUser, id: string) {
    const row = await this.prisma.costBreakdown.findFirst({
      where: { id, deletedAt: null },
      include: {
        boqItem: {
          include: {
            package: {
              include: { version: { include: { scenario: { select: { opportunityId: true } } } } },
            },
          },
        },
      },
    });
    if (!row) throw new NotFoundException('Cost breakdown line not found');
    await this.access.assertVia(user, row.boqItem.package.version.scenario.opportunityId);
    return row;
  }
}
