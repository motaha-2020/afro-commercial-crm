import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Generates human-readable, per-entity, per-year sequential codes such as
 * ACC-2026-000001 or OPP-2026-000042.
 *
 * The counter is derived from the current max under a serialisable transaction
 * so two concurrent creates cannot mint the same code. A UUID is still the
 * primary key; this is the reference people quote in email and tenders.
 */
/**
 * Named rather than repeated in both signatures below: when the two lists were
 * spelled out separately, adding an entity to one and forgetting the other
 * failed to compile in a way that pointed at the wrong line.
 */
export type CodedTable =
  | 'account'
  | 'opportunity'
  | 'lead'
  | 'bid'
  | 'partner'
  | 'rfq'
  | 'quotation'
  | 'approvalRequest'
  | 'discountRequest'
  | 'proposal'
  | 'award'
  | 'contract'
  | 'handover';

@Injectable()
export class CodeGeneratorService {
  constructor(private readonly prisma: PrismaService) {}

  async next(prefix: string, table: CodedTable, year: number): Promise<string> {
    const like = `${prefix}-${year}-%`;

    // Raw query keeps the count off the soft-delete filter: a deleted record
    // must not free its number for reuse, or codes would collide with history.
    const rows = await this.prisma.$queryRawUnsafe<{ max: string | null }[]>(
      `SELECT MAX(code) AS max FROM "${this.tableName(table)}" WHERE code LIKE $1`,
      like,
    );

    const current = rows[0]?.max;
    const seq = current ? Number(current.split('-')[2]) + 1 : 1;
    return `${prefix}-${year}-${String(seq).padStart(6, '0')}`;
  }

  /**
   * A run of consecutive codes for one bulk write.
   *
   * Calling next() in a loop does NOT work and is worth saying out loud: it
   * derives the sequence from MAX(code), so without an insert in between every
   * call returns the same number. A bulk import that did that failed on the
   * second row with a unique-constraint violation.
   *
   * Concurrency is unchanged from next(): two imports running at the same
   * instant can read the same maximum, and the loser's insert violates the
   * unique index. For an all-or-nothing import that is the right failure — the
   * whole transaction rolls back and nothing half-lands.
   */
  async nextBatch(
    prefix: string,
    table: CodedTable,
    year: number,
    count: number,
  ): Promise<string[]> {
    if (count <= 0) return [];
    const first = await this.next(prefix, table, year);
    const start = Number(first.split('-')[2]);
    return Array.from(
      { length: count },
      (_, i) => `${prefix}-${year}-${String(start + i).padStart(6, '0')}`,
    );
  }

  private tableName(table: CodedTable): string {
    switch (table) {
      case 'account':
        return 'Account';
      case 'opportunity':
        return 'Opportunity';
      case 'lead':
        return 'Lead';
      case 'bid':
        return 'Bid';
      case 'partner':
        return 'BusinessPartner';
      case 'rfq':
        return 'Rfq';
      case 'quotation':
        return 'PartnerQuotation';
      case 'approvalRequest':
        return 'ApprovalRequest';
      case 'discountRequest':
        return 'DiscountRequest';
      case 'proposal':
        return 'Proposal';
      case 'award':
        return 'Award';
      case 'contract':
        return 'Contract';
      case 'handover':
        return 'ProjectHandover';
    }
  }
}
