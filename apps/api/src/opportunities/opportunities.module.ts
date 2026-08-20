import { Module } from '@nestjs/common';
import { OpportunitiesController } from './opportunities.controller';
import { OpportunitiesService } from './opportunities.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [OpportunitiesController],
  providers: [OpportunitiesService],
  // Exported so the AI agents can read through the same service, and
  // therefore the same permission scoping, that the HTTP routes use.
  exports: [OpportunitiesService],
})
export class OpportunitiesModule {}
