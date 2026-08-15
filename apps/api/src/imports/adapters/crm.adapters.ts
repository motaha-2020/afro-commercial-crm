import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { IMPORT_DEFINITIONS } from '@acms/shared';
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

interface AccountRef {
  id: string;
  code: string;
  legalName: string;
}

/**
 * Lookups every CRM import needs: which customers this user may attach rows to,
 * and which people may own them.
 *
 * Fetched once per file. Scoped, so a row naming a customer outside the
 * reader's scope fails with the same words as one naming a customer that does
 * not exist — the system does not confirm the existence of records you are not
 * allowed to see.
 */
@Injectable()
export class CrmImportLookups {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: DataScopeService,
  ) {}

  async load(user: AuthenticatedUser) {
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

    return {
      accounts,
      byCode: new Map(accounts.map((a) => [a.code.toLowerCase(), a])),
      byName: new Map(accounts.map((a) => [a.legalName.trim().toLowerCase(), a])),
      byEmail: new Map(owners.map((u) => [u.email.toLowerCase(), u])),
    };
  }
}

type Lookups = Awaited<ReturnType<CrmImportLookups['load']>>;

/** A customer named by code or by legal name — a code is unambiguous, a name is what people have to hand. */
function findAccount(l: Lookups, ref: string): AccountRef | null {
  const key = ref.trim().toLowerCase();
  return l.byCode.get(key) ?? l.byName.get(key) ?? null;
}

function resolveOwner(
  l: Lookups,
  input: ResolveInput,
): string {
  const email = input.raw.ownerEmail;
  if (!email) return input.user.id;
  const owner = l.byEmail.get(email.toLowerCase());
  if (!owner) {
    input.errors.push({
      line: input.line,
      column: 'ownerEmail',
      message: `No active user with the address "${email}"`,
    });
    return input.user.id;
  }
  return owner.id;
}

/** Codes for a whole batch, reserved before the transaction opens. */
async function reserveCodes(
  codes: CodeGeneratorService,
  prefix: string,
  table: Parameters<CodeGeneratorService['nextBatch']>[1],
  count: number,
) {
  return codes.nextBatch(prefix, table, new Date().getFullYear(), count);
}

// ---------------------------------------------------------------------------

@Injectable()
export class AccountImportAdapter implements ImportAdapter {
  definition = IMPORT_DEFINITIONS.accounts;
  entityType = 'Account';

  constructor(
    private readonly lookups: CrmImportLookups,
    private readonly codes: CodeGeneratorService,
  ) {}

  async loadContext(): Promise<ImportContext> {
    return {};
  }

  async prepare(user: AuthenticatedUser) {
    return { ...(await this.lookups.load(user)) };
  }

  resolve(input: ResolveInput): Resolved | null {
    const l = input.lookups as unknown as Lookups;
    const ownerId = resolveOwner(l, input);

    // The parent company may itself be a row earlier in this file — a group
    // and its subsidiaries usually arrive together — so a name that matches
    // nothing yet is not rejected here; it is looked for again at write time.
    const parentRef = input.raw.parentAccountCode;
    const parent = parentRef ? findAccount(l, parentRef) : null;

    return {
      label: String(input.values.legalName),
      parentLabel: parent ? `${parent.legalName} (${parent.code})` : (parentRef || null),
      data: {
        legalName: input.values.legalName,
        type: input.values.type,
        country: input.values.country,
        tradeName: input.values.tradeName,
        industry: input.values.industry,
        city: input.values.city,
        address: input.values.address,
        website: input.values.website,
        taxId: input.values.taxId,
        paymentTermDays: input.values.paymentTermDays,
        ownerId,
        // creditStatus is never taken from the file. It defaults to GOOD in the
        // schema and is changed only by finance, through its own act.
      },
      extra: { parentId: parent?.id, parentRef: parentRef || undefined },
    };
  }

  async beforeCommit(user: AuthenticatedUser, rows: RowValues[]) {
    return reserveCodes(this.codes, 'ACC', 'account', rows.length);
  }

  async create(
    tx: Prisma.TransactionClient,
    user: AuthenticatedUser,
    row: RowValues,
    _context: ImportContext,
    helpers: CreateHelpers,
  ) {
    const codes = helpers.prepared as string[];
    const at = helpers.created.length;

    // A parent named in the file but not found before the import began may have
    // been created by an earlier row of the same file.
    let parentId = row.extra?.parentId as string | undefined;
    const parentRef = row.extra?.parentRef as string | undefined;
    if (!parentId && parentRef) {
      const earlier = await tx.account.findFirst({
        where: {
          deletedAt: null,
          OR: [{ code: parentRef }, { legalName: parentRef }],
        },
        select: { id: true },
      });
      parentId = earlier?.id;
    }

    const account = await tx.account.create({
      data: {
        ...(row.data as Prisma.AccountUncheckedCreateInput),
        code: codes[at],
        orgUnitId: user.orgUnitId,
        parentId,
      },
    });

    return { id: account.id, label: `${account.legalName} (${account.code})` };
  }
}

// ---------------------------------------------------------------------------

@Injectable()
export class ContactImportAdapter implements ImportAdapter {
  definition = IMPORT_DEFINITIONS.contacts;
  entityType = 'Contact';

  constructor(private readonly lookups: CrmImportLookups) {}

  async loadContext(): Promise<ImportContext> {
    return {};
  }

  async prepare(user: AuthenticatedUser) {
    return {
      ...(await this.lookups.load(user)),
      // "Primary" describes the customer, not the contact, so at most one may
      // hold it. Tracked across the file because two rows claiming it for the
      // same customer is a contradiction the file has to answer for.
      primaryClaims: new Map<string, number>(),
    };
  }

  resolve(input: ResolveInput): Resolved | null {
    const l = input.lookups as unknown as Lookups & {
      primaryClaims: Map<string, number>;
    };

    const account = findAccount(l, input.raw.accountCode);
    if (!account) {
      input.errors.push({
        line: input.line,
        column: 'accountCode',
        message: `No customer found matching "${input.raw.accountCode}"`,
      });
      return null;
    }

    if (input.values.isPrimary === true) {
      const first = l.primaryClaims.get(account.id);
      if (first) {
        input.errors.push({
          line: input.line,
          column: 'isPrimary',
          message: `Line ${first} already makes someone primary for this customer, and only one person can be`,
        });
      } else {
        l.primaryClaims.set(account.id, input.line);
      }
    }

    return {
      label: String(input.values.fullName),
      parentLabel: `${account.legalName} (${account.code})`,
      data: {
        accountId: account.id,
        fullName: input.values.fullName,
        jobTitle: input.values.jobTitle,
        email: input.values.email,
        phone: input.values.phone,
        mobile: input.values.mobile,
        influence: input.values.influence,
        isPrimary: input.values.isPrimary ?? false,
        notes: input.values.notes,
      },
      extra: { roles: (input.values.roles as string[]) ?? [] },
    };
  }

  async create(
    tx: Prisma.TransactionClient,
    _user: AuthenticatedUser,
    row: RowValues,
  ) {
    const data = row.data as Prisma.ContactUncheckedCreateInput;

    // Promotion demotes the incumbent in the same breath: "primary" is a fact
    // about the customer, and two of them is not a state the screen can show.
    if (data.isPrimary) {
      await tx.contact.updateMany({
        where: { accountId: data.accountId, isPrimary: true, deletedAt: null },
        data: { isPrimary: false },
      });
    }

    const contact = await tx.contact.create({ data });

    const roles = (row.extra?.roles as string[]) ?? [];
    for (const role of new Set(roles)) {
      // roleCode, not role: roles are rows keyed by a code, so re-granting one
      // that was removed revives the original row rather than adding a second.
      await tx.contactRole.create({
        data: { contactId: contact.id, roleCode: role },
      });
    }

    return { id: contact.id, label: contact.fullName };
  }
}

// ---------------------------------------------------------------------------

@Injectable()
export class LeadImportAdapter implements ImportAdapter {
  definition = IMPORT_DEFINITIONS.leads;
  entityType = 'Lead';

  constructor(
    private readonly lookups: CrmImportLookups,
    private readonly codes: CodeGeneratorService,
  ) {}

  async loadContext(): Promise<ImportContext> {
    return {};
  }

  async prepare(user: AuthenticatedUser) {
    return { ...(await this.lookups.load(user)) };
  }

  resolve(input: ResolveInput): Resolved | null {
    const l = input.lookups as unknown as Lookups;
    const ownerId = resolveOwner(l, input);

    // An enquiry may arrive before the company behind it is known, so unlike an
    // opportunity a lead may name no customer at all.
    const ref = input.raw.accountCode;
    const account = ref ? findAccount(l, ref) : null;
    if (ref && !account) {
      input.errors.push({
        line: input.line,
        column: 'accountCode',
        message: `No customer found matching "${ref}"`,
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

    return {
      label: String(input.values.name),
      parentLabel: account ? `${account.legalName} (${account.code})` : null,
      data: {
        name: input.values.name,
        source: input.values.source,
        country: input.values.country,
        industry: input.values.industry,
        estimatedValue: input.values.estimatedValue,
        currency: input.values.currency ?? 'USD',
        accountId: account?.id,
        nextStep: input.values.nextStep,
        description: input.values.description,
        ownerId,
        // Every imported lead starts NEW. A lead imported as CONVERTED would
        // claim an opportunity that does not exist, and one imported as
        // DISQUALIFIED would carry no written reason — the only thing ever
        // asked about a dead enquiry.
        status: 'NEW',
      },
    };
  }

  async beforeCommit(user: AuthenticatedUser, rows: RowValues[]) {
    return reserveCodes(this.codes, 'LED', 'lead', rows.length);
  }

  async create(
    tx: Prisma.TransactionClient,
    user: AuthenticatedUser,
    row: RowValues,
    _context: ImportContext,
    helpers: CreateHelpers,
  ) {
    const codes = helpers.prepared as string[];
    const lead = await tx.lead.create({
      data: {
        ...(row.data as Prisma.LeadUncheckedCreateInput),
        code: codes[helpers.created.length],
        orgUnitId: user.orgUnitId,
      },
    });
    return { id: lead.id, label: `${lead.name} (${lead.code})` };
  }
}

// ---------------------------------------------------------------------------

@Injectable()
export class PartnerImportAdapter implements ImportAdapter {
  definition = IMPORT_DEFINITIONS.partners;
  entityType = 'BusinessPartner';

  constructor(
    private readonly lookups: CrmImportLookups,
    private readonly codes: CodeGeneratorService,
  ) {}

  async loadContext(): Promise<ImportContext> {
    return {};
  }

  async prepare(user: AuthenticatedUser) {
    return { ...(await this.lookups.load(user)) };
  }

  resolve(input: ResolveInput): Resolved | null {
    const l = input.lookups as unknown as Lookups;
    const ownerId = resolveOwner(l, input);

    return {
      label: String(input.values.legalName),
      data: {
        legalName: input.values.legalName,
        country: input.values.country,
        tradeName: input.values.tradeName,
        city: input.values.city,
        address: input.values.address,
        taxNumber: input.values.taxNumber,
        website: input.values.website,
        contactName: input.values.contactName,
        contactEmail: input.values.contactEmail,
        contactPhone: input.values.contactPhone,
        notes: input.values.notes,
        ownerId,
        // Every imported partner starts a prospect. Approval is a separate act
        // by procurement or finance, and importing four hundred approved
        // suppliers would be the largest possible way around that rule.
        approvalStatus: 'PROSPECT',
      },
      extra: { types: (input.values.types as string[]) ?? [] },
    };
  }

  async beforeCommit(user: AuthenticatedUser, rows: RowValues[]) {
    return reserveCodes(this.codes, 'PTR', 'partner', rows.length);
  }

  async create(
    tx: Prisma.TransactionClient,
    user: AuthenticatedUser,
    row: RowValues,
    _context: ImportContext,
    helpers: CreateHelpers,
  ) {
    const codes = helpers.prepared as string[];
    const types = (row.extra?.types as string[]) ?? [];

    const partner = await tx.businessPartner.create({
      data: {
        ...(row.data as Prisma.BusinessPartnerUncheckedCreateInput),
        code: codes[helpers.created.length],
        orgUnitId: user.orgUnitId,
        types: types.length
          ? { create: [...new Set(types)].map((type) => ({ type: type as never })) }
          : undefined,
      },
    });

    return { id: partner.id, label: `${partner.legalName} (${partner.code})` };
  }
}
