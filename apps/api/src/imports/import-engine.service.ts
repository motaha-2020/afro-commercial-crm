import { BadRequestException, Injectable } from '@nestjs/common';
import {
  IMPORT_MAX_ROWS,
  importDefinition,
  importHeaders,
  parseCsv,
  toCsv,
  type ImportColumn,
  type ImportDefinition,
  type ImportPreview,
  type ImportPreviewRow,
  type ImportRowError,
} from '@acms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RefListsService } from '../master-data/ref-lists.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { ImportAdapter, ImportContext, RowValues } from './import-adapter';

/**
 * Everything a bulk import needs that is not specific to what is being
 * imported.
 *
 * Quoting, headers, required cells, reference codes, dates, numbers, booleans,
 * multi-value cells, duplicate detection, parent-child resolution inside a
 * file, the preview, and the all-or-nothing commit are the same problem for a
 * customer, a lead and a bill of quantities. They are solved here once. An
 * adapter supplies only what nobody else can know: which lookups its rows need,
 * what makes one of its rows invalid, and how to write it.
 *
 * Preview writes nothing. Commit re-validates from scratch and then writes
 * everything or nothing. The second validation is not redundant: a preview is a
 * claim about a moment that has passed, and the parent it matched may have been
 * archived, or a costing version approved and locked, in between.
 */
@Injectable()
export class ImportEngineService {
  private readonly adapters = new Map<string, ImportAdapter>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly refLists: RefListsService,
  ) {}

  register(adapter: ImportAdapter) {
    this.adapters.set(adapter.definition.resource, adapter);
  }

  template(resource: string): string {
    this.adapterFor(resource);
    return toCsv([importHeaders(resource)]);
  }

  async preview(
    user: AuthenticatedUser,
    resource: string,
    csv: string,
    contextId?: string,
  ): Promise<ImportPreview> {
    const { previews, valid } = await this.run(user, resource, csv, contextId);
    return {
      resource,
      totalRows: previews.length,
      validRows: valid.length,
      rows: previews,
    };
  }

  /**
   * All or nothing, in one transaction.
   *
   * A half-imported file is the worst outcome available: nobody can tell what
   * landed without comparing hundreds of rows by hand, and re-uploading the
   * file to finish the job duplicates everything that already succeeded.
   */
  async commit(
    user: AuthenticatedUser,
    resource: string,
    csv: string,
    contextId?: string,
  ) {
    const adapter = this.adapterFor(resource);
    const { previews, valid, context } = await this.run(user, resource, csv, contextId);

    const rejected = previews.filter((p) => p.errors.length > 0);
    if (rejected.length > 0) {
      throw new BadRequestException({
        message: 'The file still has rows that cannot be imported',
        rejectedLines: rejected.map((r) => r.line),
      });
    }
    if (valid.length === 0) {
      throw new BadRequestException('The file has no rows to import');
    }

    const prepared = adapter.beforeCommit
      ? await adapter.beforeCommit(user, valid, context)
      : undefined;

    const created = await this.prisma.$transaction(async (tx) => {
      // Rows created earlier in the same file can be the parent of later ones,
      // so ids are handed forward as the file is walked. Without this a tree
      // could only ever be imported one level at a time.
      const byRef = new Map<string, string>();
      const out: { id: string; label: string; line: number }[] = [];

      for (const row of valid) {
        const parentId = row.parentRef ? byRef.get(row.parentRef) : undefined;
        const made = await adapter.create(tx, user, row, context, {
          parentId,
          prepared,
          created: out,
        });
        if (row.ref) byRef.set(row.ref, made.id);
        out.push({ ...made, line: row.line });
      }

      return out;
    });

    // One audit entry per record, as if each had been entered by hand. A single
    // "imported 40 rows" line would leave forty records whose own history
    // begins with nothing.
    for (const record of created) {
      await this.audit.record({
        entityType: adapter.entityType,
        entityId: record.id,
        action: 'CREATE',
        userId: user.id,
        after: { label: record.label, via: 'IMPORT', resource },
      });
    }

    return {
      imported: created.length,
      records: created.map((c) => ({ id: c.id, label: c.label })),
    };
  }

  // -------------------------------------------------------------------------

  private adapterFor(resource: string): ImportAdapter {
    const adapter = this.adapters.get(resource);
    if (!adapter) throw new BadRequestException(`Nothing can be imported as "${resource}"`);
    return adapter;
  }

  private async run(
    user: AuthenticatedUser,
    resource: string,
    csv: string,
    contextId?: string,
  ) {
    const adapter = this.adapterFor(resource);
    const definition = importDefinition(resource)!;

    if (definition.scope === 'context' && !contextId) {
      throw new BadRequestException('Choose what these rows belong to before importing');
    }

    // Resolved before anything is parsed, so a locked costing version stops the
    // upload rather than five hundred identical row errors explaining it.
    const context: ImportContext = await adapter.loadContext(user, contextId);

    const table = parseCsv(csv);
    if (table.length === 0) throw new BadRequestException('The file is empty');

    const header = table[0].map((h) => h.trim());
    const missing = definition.columns.filter(
      (c) => c.required && !header.includes(c.key),
    );
    if (missing.length > 0) {
      throw new BadRequestException({
        message: 'The file is missing required columns',
        missingColumns: missing.map((c) => c.key),
      });
    }

    const body = table.slice(1);
    if (body.length > IMPORT_MAX_ROWS) {
      throw new BadRequestException(
        `A file may hold at most ${IMPORT_MAX_ROWS} rows; this one has ${body.length}`,
      );
    }

    const lists = await this.refLists.listAll(true);
    const vocab = new Map<string, Set<string>>();
    for (const list of lists) {
      vocab.set(list.key, new Set(list.items.map((i) => i.code)));
    }

    const lookups = await adapter.prepare(user, context, body.length);

    const previews: ImportPreviewRow[] = [];
    const valid: RowValues[] = [];
    const seenUnique = new Map<string, number>();
    const refs = new Map<string, number>();

    // Two passes over the tree columns: a row may name a parent declared below
    // it, and rejecting forward references would make the file order-sensitive
    // for no reason a person could guess.
    if (definition.tree) {
      body.forEach((cells, i) => {
        const ref = this.cell(header, cells, 'ref');
        if (ref) refs.set(ref.toLowerCase(), i + 2);
      });
    }

    for (const [index, cells] of body.entries()) {
      // +2: the header is line 1 and spreadsheets count from 1, so this is the
      // number shown in the row gutter.
      const line = index + 2;
      const errors: ImportRowError[] = [];
      const values: Record<string, unknown> = {};
      const raw: Record<string, string> = {};

      for (const column of definition.columns) {
        const text = this.cell(header, cells, column.key);
        raw[column.key] = text;
        const parsed = this.parseCell(column, text, { line, errors }, vocab);
        if (parsed !== undefined) values[column.key] = parsed;
      }

      // Repetition inside one file is nearly always a paste slip, and it is far
      // cheaper to say so than to unpick two identical records afterwards.
      if (definition.uniqueBy) {
        const key = String(values[definition.uniqueBy] ?? '').toLowerCase();
        if (key) {
          const first = seenUnique.get(key);
          if (first) {
            errors.push({
              line,
              column: definition.uniqueBy,
              message: `Repeats the value on line ${first}`,
            });
          } else {
            seenUnique.set(key, line);
          }
        }
      }

      let parentRef: string | undefined;
      if (definition.tree) {
        const ref = raw.ref || undefined;
        parentRef = raw.parentRef || undefined;
        if (parentRef) {
          const at = refs.get(parentRef.toLowerCase());
          if (!at) {
            errors.push({
              line,
              column: 'parentRef',
              message: `No row in this file has ref "${parentRef}"`,
            });
          } else if (at === line) {
            errors.push({
              line,
              column: 'parentRef',
              message: 'A row cannot be its own parent',
            });
          }
        }
        if (ref && parentRef && this.wouldCycle(header, body, ref, parentRef)) {
          errors.push({
            line,
            column: 'parentRef',
            message: 'These rows are each other’s parent, so the tree has a loop',
          });
        }
      }

      const resolved =
        errors.length === 0
          ? adapter.resolve({ line, values, raw, errors, lookups, user, context })
          : null;

      previews.push({
        line,
        label: resolved?.label ?? raw[definition.columns[0].key] ?? `#${line}`,
        parentLabel: resolved?.parentLabel ?? null,
        createsLabel: resolved?.createsLabel ?? null,
        errors,
      });

      if (errors.length === 0 && resolved) {
        valid.push({
          line,
          ref: definition.tree ? raw.ref || undefined : undefined,
          parentRef,
          data: resolved.data,
          extra: resolved.extra,
        });
      }
    }

    // Ordered so a parent is always written before its children.
    const ordered = definition.tree ? this.topologicallyOrder(valid) : valid;
    if (definition.tree && ordered.length !== valid.length) {
      throw new BadRequestException('The parent references in this file form a loop');
    }

    return { previews, valid: ordered, context };
  }

  private cell(header: string[], cells: string[], key: string): string {
    const at = header.indexOf(key);
    return at === -1 ? '' : (cells[at] ?? '').trim();
  }

  /** Direct mutual parentage; deeper loops are caught by the ordering pass. */
  private wouldCycle(
    header: string[],
    body: string[][],
    ref: string,
    parentRef: string,
  ): boolean {
    const parentRow = body.find(
      (c) => this.cell(header, c, 'ref').toLowerCase() === parentRef.toLowerCase(),
    );
    if (!parentRow) return false;
    return this.cell(header, parentRow, 'parentRef').toLowerCase() === ref.toLowerCase();
  }

  /** Parents first. Rows still unplaced after a full sweep are in a loop. */
  private topologicallyOrder(rows: RowValues[]): RowValues[] {
    const placed = new Set<string>();
    const out: RowValues[] = [];
    let remaining = [...rows];

    while (remaining.length > 0) {
      const ready = remaining.filter(
        (r) => !r.parentRef || placed.has(r.parentRef.toLowerCase()),
      );
      if (ready.length === 0) break;
      for (const r of ready) {
        out.push(r);
        if (r.ref) placed.add(r.ref.toLowerCase());
      }
      remaining = remaining.filter((r) => !ready.includes(r));
    }

    return out;
  }

  private parseCell(
    column: ImportColumn,
    text: string,
    ctx: { line: number; errors: ImportRowError[] },
    vocab: Map<string, Set<string>>,
  ): unknown {
    const fail = (message: string) => {
      ctx.errors.push({ line: ctx.line, column: column.key, message });
      return undefined;
    };

    if (!text) {
      if (column.required) return fail('This column cannot be empty');
      return column.fallback;
    }

    switch (column.kind) {
      case 'text':
        return text;

      case 'number': {
        // Spreadsheets hand back thousands separators and stray spaces.
        const n = Number(text.replace(/[,\s]/g, ''));
        if (!Number.isFinite(n)) return fail(`"${text}" is not a number`);
        if (n < 0) return fail('This cannot be negative');
        return n;
      }

      case 'boolean': {
        const t = text.toLowerCase();
        if (['true', 'yes', '1', 'y'].includes(t)) return true;
        if (['false', 'no', '0', 'n'].includes(t)) return false;
        return fail(`"${text}" must be yes or no`);
      }

      case 'date': {
        // ISO only, and the template says so. Accepting 03/04/2026 would mean
        // guessing between March and April, and guessing silently.
        if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
          return fail(`"${text}" must be written as YYYY-MM-DD`);
        }
        const d = new Date(`${text}T00:00:00.000Z`);
        if (Number.isNaN(d.getTime())) return fail(`"${text}" is not a real date`);
        return d;
      }

      case 'code':
      case 'codes': {
        const parts =
          column.kind === 'codes'
            ? text
                .split(/[;|]/)
                .map((p) => p.trim())
                .filter(Boolean)
            : [text];
        const out: string[] = [];

        for (const part of parts) {
          const code = part.toUpperCase().replace(/[\s-]+/g, '_');
          if (column.allowed) {
            if (!column.allowed.includes(code)) {
              return fail(`"${part}" is not one of: ${column.allowed.join(', ')}`);
            }
          } else if (column.list) {
            const allowed = vocab.get(column.list);
            // An empty reference list has never been seeded; refusing every
            // value then would blame the file for a gap in the database.
            if (allowed && allowed.size > 0 && !allowed.has(code)) {
              return fail(`"${part}" is not on the ${column.list} list`);
            }
          }
          out.push(code);
        }

        return column.kind === 'codes' ? out : out[0];
      }
    }
  }
}

export type { ImportDefinition };
