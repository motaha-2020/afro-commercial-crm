import { Module } from '@nestjs/common';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { AnalyticsService } from './analytics.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [MetricsController],
  providers: [MetricsService, AnalyticsService],
  // Exported so the AI agents read through the same service, and therefore
  // the same permission scoping, that the HTTP routes use.
  exports: [MetricsService, AnalyticsService],
})
export class MetricsModule {}
