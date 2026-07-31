import { Injectable, Logger } from '@nestjs/common';
import type { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

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
    try {
      await this.prisma.auditLog.create({ data: entry });
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
