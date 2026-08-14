import { Controller, Get, Param, Query } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RequireRoles } from '../auth/guards';

/**
 * Read-only window on the trail. There is deliberately no write, update or
 * delete endpoint: AuditLog is append-only and not even SYSTEM_ADMIN edits it.
 *
 * Restricted to the roles that answer for governance. Reading who touched a
 * record is itself sensitive — it exposes staff behaviour, not just data.
 */
@Controller('audit')
@RequireRoles('OWNER_BOARD', 'CEO', 'SALES_DIRECTOR', 'FINANCE', 'LEGAL', 'SYSTEM_ADMIN')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  /** Full history of one record, oldest last — the timeline a reviewer reads. */
  @Get(':entityType/:entityId')
  async forEntity(
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
    @Query('take') take?: string,
  ) {
    const limit = Math.min(Number(take) || 100, 500);
    const items = await this.prisma.auditLog.findMany({
      where: { entityType, entityId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        user: { select: { id: true, fullNameEn: true, fullNameAr: true, email: true } },
      },
    });
    return { items, total: items.length };
  }
}
