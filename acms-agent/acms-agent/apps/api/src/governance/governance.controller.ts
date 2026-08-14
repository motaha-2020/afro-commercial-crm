import { Controller, Get, Param } from '@nestjs/common';
import { SOD_RULES } from '@acms/shared';
import { SodService } from './sod.service';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

@Controller('governance')
export class GovernanceController {
  constructor(private readonly sod: SodService) {}

  /**
   * The eight rules as the system holds them, including the ones still waiting
   * for their module. Published rather than buried in code so governance can
   * verify what is enforced today without reading TypeScript.
   */
  @Get('sod-rules')
  rules() {
    return {
      rules: SOD_RULES.map((rule) => ({
        ...rule,
        enforced: rule.awaitingRelease === null,
      })),
    };
  }

  /** Which rules would stop the caller from approving this record, if any. */
  @Get('sod-check/:entityType/:entityId')
  async check(
    @CurrentUser() user: AuthenticatedUser,
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
  ) {
    const blocking = await this.sod.blockingRules(entityType, entityId, user);
    return { blocked: blocking.length > 0, rules: blocking };
  }
}
