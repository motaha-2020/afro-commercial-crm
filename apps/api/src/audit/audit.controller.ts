import { Controller, Get, Param, Query } from '@nestjs/common';
import { AuditService } from './audit.service';
import { RequireRoles } from '../auth/guards';
import { AUDIT_READER_ROLES } from './audit-reader-roles';

/**
 * Read-only window on the trail. There is deliberately no write, update or
 * delete endpoint: AuditLog is append-only and not even SYSTEM_ADMIN edits it.
 *
 * Restricted to the roles that answer for governance. Reading who touched a
 * record is itself sensitive — it exposes staff behaviour, not just data.
 */
@Controller('audit')
@RequireRoles(...AUDIT_READER_ROLES)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  /** Full history of one record, oldest last — the timeline a reviewer reads. */
  @Get(':entityType/:entityId')
  async forEntity(
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
    @Query('take') take?: string,
  ) {
    const items = await this.audit.forEntity(entityType, entityId, Number(take) || 100);
    return { items, total: items.length };
  }
}
