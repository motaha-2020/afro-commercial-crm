import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DataScopeService } from '../auth/data-scope.service';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * Contacts, activities and account relationships have no owner of their own —
 * they inherit the visibility of the account they hang off. This is the same
 * single gate {@link OpportunityAccessService} provides for the bid side, and
 * exists for the same reason: one forgotten filter in a child module leaks
 * another team's customer list.
 *
 * Absent and forbidden both answer 404: outside your scope the record does not
 * exist for you, and we never confirm that an id is real.
 */
@Injectable()
export class AccountAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: DataScopeService,
  ) {}

  async assert(user: AuthenticatedUser, accountId: string) {
    const filter = await this.scope.buildFilter(user);
    const account = await this.prisma.account.findFirst({
      where: { id: accountId, deletedAt: null, ...filter },
      select: { id: true, code: true, legalName: true, country: true, ownerId: true },
    });
    if (!account) throw new NotFoundException('Account not found');
    return account;
  }

  /** Same gate, reached from a child record whose parent id we already hold. */
  async assertVia(user: AuthenticatedUser, accountId: string | undefined | null) {
    if (!accountId) throw new NotFoundException('Account not found');
    return this.assert(user, accountId);
  }

  /**
   * Resolves a contact through its account's scope. Callers hold a contact id
   * and must not be able to read one belonging to an account they cannot see.
   */
  async assertContact(user: AuthenticatedUser, contactId: string) {
    const contact = await this.prisma.contact.findFirst({
      where: { id: contactId, deletedAt: null },
      select: { id: true, accountId: true, fullName: true },
    });
    if (!contact) throw new NotFoundException('Contact not found');
    await this.assert(user, contact.accountId);
    return contact;
  }
}
