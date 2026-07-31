import { Injectable, Logger } from '@nestjs/common';
import type { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { getRequestContext } from '../common/request-context';

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

    if (Object.keys(changedAfter).length === 0) return;

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
