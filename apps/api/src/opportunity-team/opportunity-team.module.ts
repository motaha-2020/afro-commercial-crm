import { Module } from '@nestjs/common';
import { OpportunityTeamController } from './opportunity-team.controller';
import { OpportunityTeamService } from './opportunity-team.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [OpportunityTeamController],
  providers: [OpportunityTeamService],
})
export class OpportunityTeamModule {}
