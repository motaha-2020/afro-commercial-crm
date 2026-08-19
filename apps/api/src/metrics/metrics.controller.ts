import { Controller, Get, Param, Query } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { MetricCode } from '@acms/shared';

@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get('dashboard')
  dashboard(@CurrentUser() user: AuthenticatedUser) {
    return this.metrics.dashboard(user);
  }

  /**
   * A report over chosen metrics: ?codes=WIN_RATE,GROSS_MARGIN
   *
   * Declared before the :code route, or Express would read "report" as a metric
   * code and answer with a definition nobody asked for.
   */
  @Get('report')
  report(@CurrentUser() user: AuthenticatedUser, @Query('codes') codes?: string) {
    const requested = (codes ?? '').split(',').map((c) => c.trim()).filter(Boolean);
    return this.metrics.report(user, requested as MetricCode[]);
  }

  @Get(':code')
  one(@CurrentUser() user: AuthenticatedUser, @Param('code') code: string) {
    return this.metrics.metric(user, code as MetricCode);
  }
}
