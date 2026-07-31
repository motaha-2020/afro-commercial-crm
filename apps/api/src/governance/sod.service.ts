import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { SOD_RULE_BY_CODE, sodRulesFor, type SodRuleCode } from '@acms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * Enforcement of the eight Segregation of Duties rules (declared in
 * `@acms/shared`).
 *
 * Every one of them reduces to the same question: did this actor originate the
 * thing they are now trying to approve? The originator is not stored on the
 * record — it is read from AuditLog, which is append-only and cannot be edited
 * to launder a conflict. That also means the rules work for entities that do
 * not exist yet: any module that audits its CREATE gets SoD for free.
 *
 * A blocked attempt is itself recorded. "Nobody tried" and "someone tried and
 * was stopped" are very different facts at audit time.
 */
@Injectable()
export class SodService {
  private readonly logger = new Logger(SodService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** The user whose CREATE entry opened this record's trail, if any. */
  async originatorOf(entityType: string, entityId: string): Promise<string | null> {
    const created = await this.prisma.auditLog.findFirst({
      where: { entityType, entityId, action: 'CREATE' },
      orderBy: { createdAt: 'asc' },
      select: { userId: true },
    });
    return created?.userId ?? null;
  }

  /**
   * Throws when the actor originated the record they are acting on. Holding
   * several roles is irrelevant by design — that is exactly the loophole rule 7
   * closes.
   */
  async assertSeparation(
    ruleCode: SodRuleCode,
    entityType: string,
    entityId: string,
    actor: AuthenticatedUser,
  ): Promise<void> {
    const originator = await this.originatorOf(entityType, entityId);
    if (!originator || originator !== actor.id) return;

    const rule = SOD_RULE_BY_CODE[ruleCode];
    await this.audit.record({
      entityType,
      entityId,
      action: 'SOD_BLOCKED',
      userId: actor.id,
      after: { rule: rule.code, blockedAction: rule.blockedAction },
    });
    this.logger.warn(
      `${rule.code} blocked ${actor.email} from ${rule.blockedAction} on ${entityType}:${entityId}`,
    );

    throw new ForbiddenException({
      message: rule.titleEn,
      messageAr: rule.titleAr,
      sodRule: rule.code,
    });
  }

  /** Rule 7 in its general form: never approve what you created. */
  assertNotSelfApproval(
    entityType: string,
    entityId: string,
    actor: AuthenticatedUser,
  ): Promise<void> {
    return this.assertSeparation('SOD_07', entityType, entityId, actor);
  }

  /**
   * Non-throwing form, so the UI can hide an Approve button instead of offering
   * an action that is guaranteed to fail.
   */
  async blockingRules(
    entityType: string,
    entityId: string,
    actor: AuthenticatedUser,
  ): Promise<SodRuleCode[]> {
    const originator = await this.originatorOf(entityType, entityId);
    if (!originator || originator !== actor.id) return [];
    return sodRulesFor(entityType).map((rule) => rule.code);
  }
}
