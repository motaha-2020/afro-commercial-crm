import { Controller, Get, Param } from '@nestjs/common';
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

  @Get(':code')
  one(@CurrentUser() user: AuthenticatedUser, @Param('code') code: string) {
    return this.metrics.metric(user, code as MetricCode);
  }
}
