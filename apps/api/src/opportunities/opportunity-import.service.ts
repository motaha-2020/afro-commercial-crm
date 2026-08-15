import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  ForecastCategory,
  HealthState,
  OpportunityStatus,
} from '@prisma/client';
import {
  FORECAST_CATEGORIES,
  HEALTH_STATES,
  OPPORTUNITY_IMPORT_COLUMNS,
  OPPORTUNITY_IMPORT_HEADERS,
  OPPORTUNITY_IMPORT_MAX_ROWS,
  OPPORTUNITY_STAGES,
  OPPORTUNITY_STATUSES,
  STAGE_EXIT_REQUIREMENTS,
  STAGE_ORDER,
  parseCsv,
  toCsv,
  type ImportPreview,
  type ImportPreviewRow,
  type ImportRowError,
  type OpportunityStage,
} from '@acms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CodeGeneratorService } from '../common/code-generator.service';
import { DataScopeService } from '../auth/data-scope.service';
import { RefListsService } from '../master-data/ref-lists.service';
import type { AuthenticatedUser } from '../auth/auth.types';

/** A row that survived validation, ready to be written. */
interface ResolvedRow {
  line: number;
  accountId: string;
  ownerId: string;
  contact: { id: string } | { create: { fullName: string; email?: string } } | null;
  data: {
    name: string;
    country: string;
    stage: OpportunityStage;
    status: OpportunityStatus;
    forecastCategory: ForecastCategory;
    health: HealthState;
    currency: string;
    estimatedValue?: number;
    receivedDate?: Date;
    expectedCloseDate?: Date;
    nextStep?: string;
    source?: string;
    industry?: string;
    description?: string;
  };
}

/**
 * Bulk import of opportunities from a spreadsheet.
 *
 * Two endpoints over one body of rules: preview validates and writes nothing,
 * commit validates again and writes everything or nothing. The second
 * validation is not redundant — the preview a user is looking at may be minutes
 * old, and the customer it matched could have been archived since. Trusting the
 * preview would make the check decorative.
 */
@Injectable()
export class OpportunityImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly codes: CodeGeneratorService,
    private readonly scope: DataScopeService,
    private readonly refLists: RefListsService,
  ) {}

  /** The empty file, with the header row only. */
  template(): string {
    return toCsv([[...OPPORTUNITY_IMPORT_HEADERS]]);
  }

  async preview(user: AuthenticatedUser, csv: string): Promise<ImportPreview> {
    const { rows, previews } = await this.validate(user, csv);
    return {
      totalRows: previews.length,
      validRows: rows.length,
      rows: previews,
      fileErrors: [],
    };
  }

  /**
   * All or nothing, in one transaction.
   *
   * A half-imported file is the worst outcome available: the operator cannot
   * tell what landed without comparing 500 rows by hand, and re-uploading the
   * file to "finish the job" duplicates everything that already succeeded.
   */
  async commit(user: AuthenticatedUser, csv: string) {
    const { rows, previews } = await this.validate(user, csv);

    const rejected = previews.filter((p) => p.errors.length > 0);
    if (rejected.length > 0) {
      throw new BadRequestException({
        message: 'The file still has rows that cannot be imported',
        rejectedLines: rejected.map((r) => r.line),
      });
    }
    if (rows.length === 0) throw new BadRequestException('The file has no rows to import');

    const year = new Date().getFullYear();
    // One run of consecutive codes, not next() in a loop: the generator derives
    // its number from MAX(code), so without an insert between calls it hands
    // back the same code every time and the second row collides.
    const codes = await this.codes.nextBatch('OPP', 'opportunity', year, rows.length);

    const created = await this.prisma.$transaction(async (tx) => {
      const out: { id: string; code: string; name: string }[] = [];

      for (const [i, row] of rows.entries()) {
        let primaryContactId: string | undefined;
        if (row.contact && 'id' in row.contact) {
          primaryContactId = row.contact.id;
        } else if (row.contact) {
          const contact = await tx.contact.create({
            data: {
              accountId: row.accountId,
              fullName: row.contact.create.fullName,
              email: row.contact.create.email,
            },
          });
          primaryContactId = contact.id;
        }

        const opp = await tx.opportunity.create({
          data: {
            ...row.data,
            code: codes[i],
            accountId: row.accountId,
            ownerId: row.ownerId,
            orgUnitId: user.orgUnitId,
            primaryContactId,
          },
        });

        // The stage history starts where the row starts. Writing a fake walk up
        // from LEAD_INTAKE would invent transitions that never happened and put
        // durations on them; the note says the stage was asserted on import,
        // not reached through the pipeline.
        await tx.opportunityStageHistory.create({
          data: {
            opportunityId: opp.id,
            fromStage: null,
            toStage: opp.stage,
            changedById: user.id,
            reason: `Imported at ${opp.stage}`,
          },
        });

        out.push({ id: opp.id, code: opp.code, name: opp.name });
      }

      return out;
    });

    // One audit entry per opportunity, as if each had been created by hand —
    // a single "imported 40 rows" line would leave 40 records whose own history
    // begins with nothing.
    for (const opp of created) {
      await this.audit.record({
        entityType: 'Opportunity',
        entityId: opp.id,
        action: 'CREATE',
        userId: user.id,
        after: { code: opp.code, name: opp.name, via: 'IMPORT' },
      });
    }

    return { imported: created.length, opportunities: created };
  }

  // -------------------------------------------------------------------------

  private async validate(user: AuthenticatedUser, csv: string) {
    const table = parseCsv(csv);
    if (table.length === 0) throw new BadRequestException('The file is empty');

    const header = table[0].map((h) => h.trim());
    const missingColumns = OPPORTUNITY_IMPORT_COLUMNS.filter(
      (c) => c.required && !header.includes(c.key),
    );
    if (missingColumns.length > 0) {
      throw new BadRequestException({
        message: 'The file is missing required columns',
        missingColumns: missingColumns.map((c) => c.key),
      });
    }

    const body = table.slice(1);
    if (body.length > OPPORTUNITY_IMPORT_MAX_ROWS) {
      throw new BadRequestException(
        `A file may hold at most ${OPPORTUNITY_IMPORT_MAX_ROWS} rows; this one has ${body.length}`,
      );
    }

    // Everything the rows will be checked against, fetched once rather than
    // per row: 500 rows would otherwise be 500 round trips to say the same
    // thing about the same customer.
    const scopeFilter = await this.scope.buildFilter(user);
    const [accounts, owners, lists] = await Promise.all([
      this.prisma.account.findMany({
        where: { deletedAt: null, ...scopeFilter },
        select: { id: true, code: true, legalName: true },
      }),
      this.prisma.user.findMany({
        where: { deletedAt: null, isActive: true },
        select: { id: true, email: true },
      }),
      this.refLists.listAll(true),
    ]);

    const byCode = new Map(accounts.map((a) => [a.code.toLowerCase(), a]));
    const byName = new Map(accounts.map((a) => [a.legalName.trim().toLowerCase(), a]));
    const byEmail = new Map(owners.map((u) => [u.email.toLowerCase(), u]));
    const codesOf = (key: string) =>
      new Set(lists.find((l) => l.key === key)?.items.map((i) => i.code) ?? []);
    const vocab = {
      COUNTRY: codesOf('COUNTRY'),
      CURRENCY: codesOf('CURRENCY'),
      LEAD_SOURCE: codesOf('LEAD_SOURCE'),
      INDUSTRY: codesOf('INDUSTRY'),
    };

    const contacts = await this.prisma.contact.findMany({
      where: { deletedAt: null, accountId: { in: accounts.map((a) => a.id) } },
      select: { id: true, accountId: true, fullName: true, email: true },
    });

    const previews: ImportPreviewRow[] = [];
    const resolved: ResolvedRow[] = [];
    const seenNames = new Map<string, number>();

    for (const [index, cells] of body.entries()) {
      // +2: the header is line 1 and spreadsheets count from 1, so this is the
      // number the operator sees in the row gutter.
      const line = index + 2;
      const errors: ImportRowError[] = [];
      const get = (key: string) => {
        const at = header.indexOf(key);
        return at === -1 ? '' : (cells[at] ?? '').trim();
      };

      const name = get('name');
      if (!name) errors.push({ line, column: 'name', message: 'Name is required' });

      // A file that names the same opportunity twice is nearly always a
      // copy-paste slip, and it is far cheaper to say so than to unpick two
      // identical records afterwards.
      if (name) {
        const first = seenNames.get(name.toLowerCase());
        if (first) {
          errors.push({
            line,
            column: 'name',
            message: `Repeats the name on line ${first}`,
          });
        } else {
          seenNames.set(name.toLowerCase(), line);
        }
      }

      const accountRef = get('accountCode');
      const account = accountRef
        ? (byCode.get(accountRef.toLowerCase()) ??
          byName.get(accountRef.toLowerCase()) ??
          null)
        : null;
      if (!accountRef) {
        errors.push({ line, column: 'accountCode', message: 'Customer is required' });
      } else if (!account) {
        // Deliberately the same message whether the customer does not exist or
        // merely lies outside this user's scope: the system does not confirm
        // the existence of records the reader may not see.
        errors.push({
          line,
          column: 'accountCode',
          message: `No customer found matching "${accountRef}"`,
        });
      }

      const country = get('country').toUpperCase();
      if (!country) {
        errors.push({ line, column: 'country', message: 'Country is required' });
      } else if (vocab.COUNTRY.size > 0 && !vocab.COUNTRY.has(country)) {
        errors.push({
          line,
          column: 'country',
          message: `"${country}" is not a country on the reference list`,
        });
      }

      const stage = this.pickCode(get('stage'), OPPORTUNITY_STAGES, 'LEAD_INTAKE', {
        line,
        column: 'stage',
        errors,
      });
      const status = this.pickCode(get('status'), OPPORTUNITY_STATUSES, 'ACTIVE', {
        line,
        column: 'status',
        errors,
      });
      const forecastCategory = this.pickCode(
        get('forecastCategory'),
        FORECAST_CATEGORIES,
        'PIPELINE',
        { line, column: 'forecastCategory', errors },
      );
      const health = this.pickCode(get('health'), HEALTH_STATES, 'GREEN', {
        line,
        column: 'health',
        errors,
      });

      const estimatedValue = this.num(get('estimatedValue'), {
        line,
        column: 'estimatedValue',
        errors,
      });

      // A number without its currency is the defect that put "USD 15.00M" over
      // an Egyptian pipeline. An imported value must say what it is in.
      const currencyCell = get('currency').toUpperCase();
      if (estimatedValue !== undefined && !currencyCell) {
        errors.push({
          line,
          column: 'currency',
          message: 'A value needs its currency; a number alone cannot be trusted',
        });
      }
      if (currencyCell && vocab.CURRENCY.size > 0 && !vocab.CURRENCY.has(currencyCell)) {
        errors.push({
          line,
          column: 'currency',
          message: `"${currencyCell}" is not a currency on the reference list`,
        });
      }

      const receivedDate = this.date(get('receivedDate'), {
        line,
        column: 'receivedDate',
        errors,
      });
      const expectedCloseDate = this.date(get('expectedCloseDate'), {
        line,
        column: 'expectedCloseDate',
        errors,
      });
      if (receivedDate && expectedCloseDate && expectedCloseDate < receivedDate) {
        errors.push({
          line,
          column: 'expectedCloseDate',
          message: 'Closes before it arrived',
        });
      }

      const source = this.optionalCode(get('source'), vocab.LEAD_SOURCE, {
        line,
        column: 'source',
        errors,
      });
      const industry = this.optionalCode(get('industry'), vocab.INDUSTRY, {
        line,
        column: 'industry',
        errors,
      });

      const ownerEmail = get('ownerEmail');
      const owner = ownerEmail ? byEmail.get(ownerEmail.toLowerCase()) : undefined;
      if (ownerEmail && !owner) {
        errors.push({
          line,
          column: 'ownerEmail',
          message: `No active user with the address "${ownerEmail}"`,
        });
      }

      // Who sent it. Matched on email first because two people share a name far
      // more often than they share an inbox.
      const contactName = get('contactName');
      const contactEmail = get('contactEmail');
      let contact: ResolvedRow['contact'] = null;
      let createsContact: string | null = null;
      if (account && (contactName || contactEmail)) {
        const existing = contacts.find(
          (c) =>
            c.accountId === account.id &&
            ((contactEmail && c.email?.toLowerCase() === contactEmail.toLowerCase()) ||
              (!contactEmail &&
                !!contactName &&
                c.fullName.trim().toLowerCase() === contactName.toLowerCase())),
        );
        if (existing) {
          contact = { id: existing.id };
        } else if (contactName) {
          contact = {
            create: { fullName: contactName, email: contactEmail || undefined },
          };
          createsContact = contactName;
        } else {
          errors.push({
            line,
            column: 'contactName',
            message: 'A new contact needs a name, not only an address',
          });
        }
      }

      const nextStep = get('nextStep');
      const description = get('description');

      const data: ResolvedRow['data'] = {
        name,
        country,
        stage,
        status,
        forecastCategory,
        health,
        currency: currencyCell || 'USD',
        ...(estimatedValue !== undefined ? { estimatedValue } : {}),
        ...(receivedDate ? { receivedDate } : {}),
        ...(expectedCloseDate ? { expectedCloseDate } : {}),
        ...(nextStep ? { nextStep } : {}),
        ...(source ? { source } : {}),
        ...(industry ? { industry } : {}),
        ...(description ? { description } : {}),
      };

      // Progressive Data Capture applies to an imported row exactly as it does
      // to one advanced by hand. A spreadsheet is not a way in through the
      // back: landing at COSTING_SOURCING means every obligation up to that
      // stage must already be satisfied, or the pipeline fills with rows that
      // could never have got there by the front door.
      if (errors.length === 0) {
        for (const missing of this.missingForStage(stage, data, contact)) {
          errors.push({
            line,
            column: missing,
            message: `Stage "${stage}" requires ${missing}`,
          });
        }
      }

      previews.push({
        line,
        name,
        accountLabel: account ? `${account.legalName} (${account.code})` : null,
        stage,
        createsContact,
        errors,
      });

      if (errors.length === 0 && account) {
        resolved.push({
          line,
          accountId: account.id,
          ownerId: owner?.id ?? user.id,
          contact,
          data,
        });
      }
    }

    return { rows: resolved, previews };
  }

  /**
   * Which obligations a row landing at this stage has not met.
   *
   * Mirrors the walk in changeStage: every stage strictly below the target must
   * have its exit requirements satisfied. Fields the importer cannot supply —
   * a costing figure, a bid score — are not silently waived; they are exactly
   * why a row cannot be imported straight into a late stage.
   */
  private missingForStage(
    stage: OpportunityStage,
    data: ResolvedRow['data'],
    contact: ResolvedRow['contact'],
  ): string[] {
    const present: Record<string, unknown> = {
      ...data,
      // Always satisfied for an imported row: it names a customer and an owner
      // or it never got this far.
      accountId: 'set',
      ownerId: 'set',
      primaryContactId: contact ? 'set' : undefined,
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

  private pickCode<T extends string>(
    raw: string,
    allowed: readonly T[],
    fallback: T,
    ctx: { line: number; column: string; errors: ImportRowError[] },
  ): T {
    if (!raw) return fallback;
    const upper = raw.toUpperCase().replace(/[\s-]+/g, '_');
    if (!allowed.includes(upper as T)) {
      ctx.errors.push({
        line: ctx.line,
        column: ctx.column,
        message: `"${raw}" is not one of: ${allowed.join(', ')}`,
      });
      return fallback;
    }
    return upper as T;
  }

  private optionalCode(
    raw: string,
    allowed: Set<string>,
    ctx: { line: number; column: string; errors: ImportRowError[] },
  ): string | undefined {
    if (!raw) return undefined;
    const upper = raw.toUpperCase().replace(/[\s-]+/g, '_');
    // An empty reference list means it has never been seeded; refusing every
    // value then would blame the file for a gap in the database.
    if (allowed.size > 0 && !allowed.has(upper)) {
      ctx.errors.push({
        line: ctx.line,
        column: ctx.column,
        message: `"${raw}" is not on the reference list`,
      });
      return undefined;
    }
    return upper;
  }

  private num(
    raw: string,
    ctx: { line: number; column: string; errors: ImportRowError[] },
  ): number | undefined {
    if (!raw) return undefined;
    // Spreadsheets hand back thousands separators and stray currency symbols.
    const cleaned = raw.replace(/[,\s]/g, '');
    const n = Number(cleaned);
    if (!Number.isFinite(n)) {
      ctx.errors.push({
        line: ctx.line,
        column: ctx.column,
        message: `"${raw}" is not a number`,
      });
      return undefined;
    }
    if (n < 0) {
      ctx.errors.push({
        line: ctx.line,
        column: ctx.column,
        message: 'A value cannot be negative',
      });
      return undefined;
    }
    return n;
  }

  private date(
    raw: string,
    ctx: { line: number; column: string; errors: ImportRowError[] },
  ): Date | undefined {
    if (!raw) return undefined;
    // ISO only, and said so in the template. Accepting 03/04/2026 would mean
    // guessing between March and April, and guessing wrong silently.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      ctx.errors.push({
        line: ctx.line,
        column: ctx.column,
        message: `"${raw}" must be written as YYYY-MM-DD`,
      });
      return undefined;
    }
    const d = new Date(`${raw}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime())) {
      ctx.errors.push({
        line: ctx.line,
        column: ctx.column,
        message: `"${raw}" is not a real date`,
      });
      return undefined;
    }
    return d;
  }
}
