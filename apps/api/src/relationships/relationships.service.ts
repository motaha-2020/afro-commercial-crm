import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  inverseAccountRelationship,
  type AccountRelationshipType,
} from '@acms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AccountAccessService } from '../common/account-access.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type {
  CreateAccountRelationshipDto,
  UpdateAccountRelationshipDto,
} from './dto';

const ACCOUNT_CARD = {
  id: true,
  code: true,
  legalName: true,
  tradeName: true,
  country: true,
  type: true,
} as const;

@Injectable()
export class RelationshipsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly accounts: AccountAccessService,
  ) {}

  /**
   * Every link touching this account, read from this account's side.
   *
   * A row is stored once, in one direction. Listing only `fromId` would mean a
   * subsidiary's own file never mentioned its parent — the relationship would
   * exist but be invisible from the end that most often needs it. So both
   * directions are fetched and the stored ones are flipped on the way out,
   * using the inverse map in `@acms/shared` rather than a second row.
   */
  async list(user: AuthenticatedUser, accountId: string) {
    await this.accounts.assert(user, accountId);

    const rows = await this.prisma.accountRelationship.findMany({
      where: {
        deletedAt: null,
        OR: [{ fromId: accountId }, { toId: accountId }],
        // The far end must still exist. A soft-deleted account is gone from
        // every list, and a link is not a way back to it.
        from: { deletedAt: null },
        to: { deletedAt: null },
      },
      orderBy: { createdAt: 'asc' },
      include: {
        from: { select: ACCOUNT_CARD },
        to: { select: ACCOUNT_CARD },
      },
    });

    // Scope is checked once per distinct counterparty rather than per row: the
    // same parent company shows up on every subsidiary link, and asking the
    // database again for each of them buys nothing.
    const visible = new Map<string, boolean>();
    const canSee = async (id: string) => {
      const known = visible.get(id);
      if (known !== undefined) return known;
      const allowed = await this.accounts
        .assert(user, id)
        .then(() => true)
        .catch(() => false);
      visible.set(id, allowed);
      return allowed;
    };

    const items: {
      id: string;
      typeCode: AccountRelationshipType;
      isOutgoing: boolean;
      counterparty: (typeof rows)[number]['to'];
      notes: string | null;
      createdAt: Date;
    }[] = [];

    for (const row of rows) {
      const outgoing = row.fromId === accountId;
      const other = outgoing ? row.to : row.from;

      // A link to an account outside your scope is dropped whole. Showing the
      // name would hand you a customer you are not allowed to know exists, and
      // showing a blank counterparty would be a row that says nothing.
      if (!(await canSee(other.id))) continue;

      items.push({
        id: row.id,
        // What the link means read from *this* account: stored one way,
        // reported from whichever end you are standing at.
        typeCode: outgoing
          ? (row.typeCode as AccountRelationshipType)
          : inverseAccountRelationship(row.typeCode as AccountRelationshipType),
        /** False when this row was recorded from the other account's file. */
        isOutgoing: outgoing,
        counterparty: other,
        notes: row.notes,
        createdAt: row.createdAt,
      });
    }

    return { items, total: items.length };
  }

  async create(
    user: AuthenticatedUser,
    accountId: string,
    dto: CreateAccountRelationshipDto,
  ) {
    // Both ends are checked, and this is the whole security question in this
    // module: without the second check, anyone could name an id they cannot
    // see and read the legal name straight back out of the list.
    await this.accounts.assert(user, accountId);
    await this.accounts.assert(user, dto.toId);

    if (accountId === dto.toId) {
      throw new BadRequestException('An account cannot be related to itself');
    }

    // The same pair may already be linked the other way round: A recorded as
    // B's parent is B recorded as A's subsidiary, and storing both would be
    // one fact in two rows that can later disagree.
    const inverse = inverseAccountRelationship(dto.typeCode);
    const mirrored = await this.prisma.accountRelationship.findFirst({
      where: {
        fromId: dto.toId,
        toId: accountId,
        typeCode: inverse,
        deletedAt: null,
      },
    });
    if (mirrored) {
      throw new BadRequestException(
        'This relationship is already recorded from the other account, where it reads as its opposite',
      );
    }

    // A link removed earlier leaves a soft-deleted row holding the unique
    // triple, so re-adding it revives that row rather than failing on a
    // duplicate key — the same shape as reviving a contact role.
    const relationship = await this.prisma.accountRelationship.upsert({
      where: {
        fromId_toId_typeCode: {
          fromId: accountId,
          toId: dto.toId,
          typeCode: dto.typeCode,
        },
      },
      create: {
        fromId: accountId,
        toId: dto.toId,
        typeCode: dto.typeCode,
        notes: dto.notes,
      },
      update: { deletedAt: null, notes: dto.notes },
      include: { to: { select: ACCOUNT_CARD } },
    });

    await this.audit.record({
      entityType: 'AccountRelationship',
      entityId: relationship.id,
      action: 'CREATE',
      userId: user.id,
      after: {
        fromId: accountId,
        toId: dto.toId,
        typeCode: dto.typeCode,
      },
    });

    return relationship;
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateAccountRelationshipDto) {
    const existing = await this.findAccessible(user, id);

    const updated = await this.prisma.accountRelationship.update({
      where: { id },
      data: { notes: dto.notes },
      include: { to: { select: ACCOUNT_CARD } },
    });

    await this.audit.recordUpdate(
      'AccountRelationship',
      id,
      { notes: existing.notes },
      { notes: updated.notes },
      user.id,
    );

    return updated;
  }

  async remove(user: AuthenticatedUser, id: string) {
    const existing = await this.findAccessible(user, id);

    await this.prisma.accountRelationship.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await this.audit.record({
      entityType: 'AccountRelationship',
      entityId: id,
      action: 'SOFT_DELETE',
      userId: user.id,
      before: {
        fromId: existing.fromId,
        toId: existing.toId,
        typeCode: existing.typeCode,
      },
    });

    return { success: true };
  }

  /**
   * A relationship is reachable from either end, so holding *either* account
   * is enough to manage it — but holding neither means it does not exist for
   * you, and says 404 rather than 403 like everything else in the system.
   */
  private async findAccessible(user: AuthenticatedUser, id: string) {
    const row = await this.prisma.accountRelationship.findFirst({
      where: { id, deletedAt: null },
    });
    if (!row) throw new NotFoundException('Relationship not found');

    const reachable = await this.accounts
      .assert(user, row.fromId)
      .then(() => true)
      .catch(() => false);
    if (!reachable) await this.accounts.assert(user, row.toId);

    return row;
  }
}
