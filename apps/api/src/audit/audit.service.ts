import { Injectable, Logger } from '@nestjs/common';
import type { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { getRequestContext, markAudited } from '../common/request-context';

export interface AuditEntry {
  entityType: string;
  entityId: string;
  action: AuditAction;
  userId?: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Audit writes must never take down the operation they describe — a failed
   * log line is a monitoring problem, not a reason to reject a user's work.
   * Failures are logged loudly rather than thrown.
   */
  /**
   * The history of one record, newest first.
   *
   * Callers are responsible for the role check -- see AUDIT_READER_ROLES. This
   * method deliberately does not enforce it, because the HTTP route enforces
   * it through a guard and the in-process callers enforce it themselves; a
   * check in two places that disagree is worse than one that is explicit.
   */
  forEntity(entityType: string, entityId: string, take = 100) {
    return this.prisma.auditLog.findMany({
      where: { entityType, entityId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(take, 500),
      include: {
        user: { select: { id: true, fullNameEn: true, fullNameAr: true, email: true } },
      },
    });
  }

  async record(entry: AuditEntry): Promise<void> {
    // Fill actor, address and request id from the ambient request context when
    // the caller did not supply them — so every call site stays terse and no
    // entry silently loses its attribution.
    const ctx = getRequestContext();
    const enriched: AuditEntry = {
      ...entry,
      userId: entry.userId ?? ctx?.userId,
      ipAddress: entry.ipAddress ?? ctx?.ipAddress,
      userAgent: entry.userAgent ?? ctx?.userAgent,
      requestId: entry.requestId ?? ctx?.requestId,
    };

    // Claimed before the write: if the insert fails the request must not then
    // collect a vaguer envelope entry from the interceptor and look logged.
    markAudited();

    try {
      await this.prisma.auditLog.create({ data: enriched });
    } catch (error) {
      this.logger.error(
        `Failed to write audit entry for ${entry.entityType}:${entry.entityId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * Records only the fields that actually changed. Storing whole entities makes
   * the log expensive and buries the change that matters.
   */
  async recordUpdate(
    entityType: string,
    entityId: string,
    before: Record<string, unknown>,
    after: Record<string, unknown>,
    userId?: string,
  ): Promise<void> {
    const changedBefore: Record<string, unknown> = {};
    const changedAfter: Record<string, unknown> = {};

    for (const key of Object.keys(after)) {
      if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
        changedBefore[key] = before[key];
        changedAfter[key] = after[key];
      }
    }

    if (Object.keys(changedAfter).length === 0) {
      // A no-op update is a deliberate non-event, not a gap in the trail — say
      // so, or the interceptor will invent an UPDATE entry for it.
      markAudited();
      return;
    }

    await this.record({
      entityType,
      entityId,
      action: 'UPDATE',
      userId,
      before: changedBefore as Prisma.InputJsonValue,
      after: changedAfter as Prisma.InputJsonValue,
    });
  }
}
