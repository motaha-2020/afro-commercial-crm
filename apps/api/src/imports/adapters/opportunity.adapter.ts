import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  IMPORT_DEFINITIONS,
  STAGE_EXIT_REQUIREMENTS,
  STAGE_ORDER,
  type OpportunityStage,
} from '@acms/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { CodeGeneratorService } from '../../common/code-generator.service';
import { DataScopeService } from '../../auth/data-scope.service';
import type { AuthenticatedUser } from '../../auth/auth.types';
import type {
  CreateHelpers,
  ImportAdapter,
  ImportContext,
  ResolveInput,
  Resolved,
  RowValues,
} from '../import-adapter';

@Injectable()
export class OpportunityImportAdapter implements ImportAdapter {
  definition = IMPORT_DEFINITIONS.opportunities;
  entityType = 'Opportunity';

  constructor(
    private readonly prisma: PrismaService,
    private readonly codes: CodeGeneratorService,
    private readonly scope: DataScopeService,
  ) {}

  async loadContext(): Promise<ImportContext> {
    return {};
  }

  async prepare(user: AuthenticatedUser) {
    const scopeFilter = await this.scope.buildFilter(user);
    const [accounts, owners] = await Promise.all([
      this.prisma.account.findMany({
        where: { deletedAt: null, ...scopeFilter },
        select: { id: true, code: true, legalName: true },
      }),
      this.prisma.user.findMany({
        where: { deletedAt: null, isActive: true },
        select: { id: true, email: true },
      }),
    ]);

    const contacts = await this.prisma.contact.findMany({
      where: { deletedAt: null, accountId: { in: accounts.map((a) => a.id) } },
      select: { id: true, accountId: true, fullName: true, email: true },
    });

    return {
      byCode: new Map(accounts.map((a) => [a.code.toLowerCase(), a])),
      byName: new Map(accounts.map((a) => [a.legalName.trim().toLowerCase(), a])),
      byEmail: new Map(owners.map((u) => [u.email.toLowerCase(), u])),
      contacts,
    };
  }

  resolve(input: ResolveInput): Resolved | null {
    const l = input.lookups as {
      byCode: Map<string, { id: string; code: string; legalName: string }>;
      byName: Map<string, { id: string; code: string; legalName: string }>;
      byEmail: Map<string, { id: string }>;
      contacts: { id: string; accountId: string; fullName: string; email: string | null }[];
    };

    const ref = input.raw.accountCode.toLowerCase();
    const account = l.byCode.get(ref) ?? l.byName.get(ref) ?? null;
    if (!account) {
      input.errors.push({
        line: input.line,
        column: 'accountCode',
        message: `No customer found matching "${input.raw.accountCode}"`,
      });
      return null;
    }

    const ownerEmail = input.raw.ownerEmail;
    const owner = ownerEmail ? l.byEmail.get(ownerEmail.toLowerCase()) : undefined;
    if (ownerEmail && !owner) {
      input.errors.push({
        line: input.line,
        column: 'ownerEmail',
        message: `No active user with the address "${ownerEmail}"`,
      });
    }

    // A number without its currency is the defect that put "USD 15.00M" over an
    // Egyptian pipeline. A bulk path is the last place to let it back in.
    if (input.values.estimatedValue !== undefined && !input.values.currency) {
      input.errors.push({
        line: input.line,
        column: 'currency',
        message: 'A value needs its currency; a number alone cannot be trusted',
      });
    }

    const receivedDate = input.values.receivedDate as Date | undefined;
    const expectedCloseDate = input.values.expectedCloseDate as Date | undefined;
    if (receivedDate && expectedCloseDate && expectedCloseDate < receivedDate) {
      input.errors.push({
        line: input.line,
        column: 'expectedCloseDate',
        message: 'Closes before it arrived',
      });
    }

    // Who sent it. Matched on email first: two people share a name far more
    // often than they share an inbox.
    const contactName = input.raw.contactName;
    const contactEmail = input.raw.contactEmail;
    let contactId: string | undefined;
    let createsLabel: string | null = null;
    if (contactName || contactEmail) {
      const existing = l.contacts.find(
        (c) =>
          c.accountId === account.id &&
          ((contactEmail && c.email?.toLowerCase() === contactEmail.toLowerCase()) ||
            (!contactEmail &&
              !!contactName &&
              c.fullName.trim().toLowerCase() === contactName.toLowerCase())),
      );
      if (existing) {
        contactId = existing.id;
      } else if (contactName) {
        createsLabel = contactName;
      } else {
        input.errors.push({
          line: input.line,
          column: 'contactName',
          message: 'A new contact needs a name, not only an address',
        });
      }
    }

    const stage = input.values.stage as OpportunityStage;
    const data = {
      name: input.values.name,
      country: input.values.country,
      stage,
      status: input.values.status,
      forecastCategory: input.values.forecastCategory,
      health: input.values.health,
      currency: input.values.currency ?? 'USD',
      estimatedValue: input.values.estimatedValue,
      receivedDate,
      expectedCloseDate,
      nextStep: input.values.nextStep,
      source: input.values.source,
      industry: input.values.industry,
      description: input.values.description,
      accountId: account.id,
      ownerId: owner?.id ?? input.user.id,
    };

    // Progressive Data Capture applies to an imported row exactly as it does to
    // one advanced by hand. A spreadsheet is not a way in through the back:
    // landing at COSTING_SOURCING means every obligation up to that stage must
    // already be satisfied, or the pipeline fills with rows that could never
    // have got there by the front door.
    if (input.errors.length === 0) {
      for (const missing of this.missingForStage(stage, data, contactId || createsLabel)) {
        input.errors.push({
          line: input.line,
          column: missing,
          message: `Stage "${stage}" requires ${missing}`,
        });
      }
    }

    return {
      label: String(input.values.name),
      parentLabel: `${account.legalName} (${account.code})`,
      createsLabel,
      data,
      extra: { contactId, newContactName: createsLabel, contactEmail: contactEmail || undefined },
    };
  }

  private missingForStage(
    stage: OpportunityStage,
    data: Record<string, unknown>,
    hasContact: unknown,
  ): string[] {
    const present: Record<string, unknown> = {
      ...data,
      accountId: 'set',
      ownerId: 'set',
      primaryContactId: hasContact ? 'set' : undefined,
    };

    const missing = new Set<string>();
    for (const s of Object.keys(STAGE_ORDER) as OpportunityStage[]) {
      if (STAGE_ORDER[s] >= STAGE_ORDER[stage]) continue;
      for (const field of STAGE_EXIT_REQUIREMENTS[s]) {
        const v = present[field];
        if (v === null || v === undefined || v === '') missing.add(field);
      }
    }
    return [...missing];
  }

  async beforeCommit(user: AuthenticatedUser, rows: RowValues[]) {
    return this.codes.nextBatch('OPP', 'opportunity', new Date().getFullYear(), rows.length);
  }

  async create(
    tx: Prisma.TransactionClient,
    user: AuthenticatedUser,
    row: RowValues,
    _context: ImportContext,
    helpers: CreateHelpers,
  ) {
    const codes = helpers.prepared as string[];
    const data = row.data as Prisma.OpportunityUncheckedCreateInput;

    let primaryContactId = row.extra?.contactId as string | undefined;
    const newContactName = row.extra?.newContactName as string | undefined;
    if (!primaryContactId && newContactName) {
      const contact = await tx.contact.create({
        data: {
          accountId: data.accountId,
          fullName: newContactName,
          email: row.extra?.contactEmail as string | undefined,
        },
      });
      primaryContactId = contact.id;
    }

    const opp = await tx.opportunity.create({
      data: {
        ...data,
        code: codes[helpers.created.length],
        orgUnitId: user.orgUnitId,
        primaryContactId,
      },
    });

    // The stage history starts where the row starts. Writing a synthetic walk
    // up from LEAD_INTAKE would invent transitions that never happened and put
    // durations on them.
    await tx.opportunityStageHistory.create({
      data: {
        opportunityId: opp.id,
        fromStage: null,
        toStage: opp.stage,
        changedById: user.id,
        reason: `Imported at ${opp.stage}`,
      },
    });

    return { id: opp.id, label: `${opp.name} (${opp.code})` };
  }
}
